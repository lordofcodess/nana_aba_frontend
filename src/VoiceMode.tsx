// ChatGPT-style voice-to-voice overlay.
//
// Loop: auto-listen → detect end of speech (silence) → send audio to
// /voice/converse → play the spoken reply → auto-listen again. Tap the orb to
// interrupt (while speaking) or end your turn early (while talking). X exits.
// Each exchange is pushed into the main chat thread via onExchange.

import { useCallback, useEffect, useRef, useState } from "react";
import { voiceConverse, type ChatMsg } from "./api";
import "./VoiceMode.css";

type Phase = "starting" | "listening" | "thinking" | "speaking" | "error";

interface Props {
  history: ChatMsg[];
  onExchange: (userText: string, assistantText: string, viaWeb: boolean) => void;
  onClose: () => void;
}

// Silence-detection tuning (RMS of the time-domain signal, 0..1 scale).
const SPEECH_START_RMS = 0.045;
const SPEECH_KEEP_RMS = 0.022;
const SILENCE_MS = 1400; // this long below KEEP after speech started → send
const MAX_UTTERANCE_MS = 30_000;
const MIN_BLOB_BYTES = 4000; // ignore accidental blips

function pickMime(): { rec: string | undefined; send: string } {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const rec = candidates.find(
    (m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
  );
  return { rec, send: rec?.includes("mp4") ? "audio/mp4" : "audio/webm" };
}

export default function VoiceMode({ history, onExchange, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [level, setLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [caption, setCaption] = useState<string>("");

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const closedRef = useRef(false);
  const phaseRef = useRef<Phase>("starting");
  const historyRef = useRef<ChatMsg[]>(history);
  const speech = useRef({ started: false, lastLoud: 0, begunAt: 0 });
  const discardRef = useRef(false);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const setPhaseSafe = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const stopMeter = useCallback(() => {
    if (meterRef.current !== null) {
      window.clearInterval(meterRef.current);
      meterRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    const el = audioRef.current;
    const url = audioUrlRef.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.pause();
      // Detach the src before revoking so Safari doesn't complain about a
      // blob resource disappearing while the media element still references
      // it (WebKitBlobResource error 1).
      try { el.removeAttribute("src"); el.load(); } catch { /* ignore */ }
      audioRef.current = null;
    }
    if (url) {
      // Defer the revoke one frame — gives WebKit time to release the blob
      // reference cleanly after we cleared src above.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      audioUrlRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    closedRef.current = true;
    stopMeter();
    stopPlayback();
    abortRef.current?.abort();
    if (recRef.current && recRef.current.state !== "inactive") {
      discardRef.current = true;
      try {
        recRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, [stopMeter, stopPlayback]);

  const playReply = useCallback(
    (b64: string, mime: string) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      setPhaseSafe("speaking");
      audio.onended = () => {
        stopPlayback();
        if (!closedRef.current) beginListening();
      };
      audio.play().catch(() => {
        // Autoplay refused (shouldn't happen — user gestured to open the mode)
        stopPlayback();
        if (!closedRef.current) beginListening();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setPhaseSafe, stopPlayback],
  );

  const sendUtterance = useCallback(
    async (blob: Blob) => {
      setPhaseSafe("thinking");
      setCaption("");
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const resp = await voiceConverse(blob, historyRef.current, controller.signal);
        if (closedRef.current || controller.signal.aborted) return;
        setCaption(resp.answer);
        onExchange(resp.transcript, resp.answer, resp.via_web);
        playReply(resp.audio_b64, resp.mime || "audio/wav");
      } catch (e) {
        if (closedRef.current || (e as Error).name === "AbortError") return;
        const msg = (e as Error).message || "Something went wrong";
        // Unintelligible / silent recordings: just listen again quietly.
        if (/silent|unintelligible/i.test(msg)) {
          beginListening();
          return;
        }
        setErrorMsg(msg);
        setPhaseSafe("error");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onExchange, playReply, setPhaseSafe],
  );

  const beginListening = useCallback(async () => {
    if (closedRef.current) return;
    setErrorMsg(null);
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
        const src = audioCtxRef.current.createMediaStreamSource(streamRef.current);
        const analyser = audioCtxRef.current.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        analyserRef.current = analyser;
      }
      if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();

      const { rec: recMime, send: sendMime } = pickMime();
      const rec = recMime
        ? new MediaRecorder(streamRef.current, { mimeType: recMime })
        : new MediaRecorder(streamRef.current);
      chunksRef.current = [];
      discardRef.current = false;
      rec.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      rec.onstop = () => {
        stopMeter();
        if (closedRef.current || discardRef.current) return;
        const blob = new Blob(chunksRef.current, { type: sendMime });
        if (blob.size < MIN_BLOB_BYTES || !speech.current.started) {
          // Nothing meaningful was said — resume listening.
          beginListening();
          return;
        }
        void sendUtterance(blob);
      };
      recRef.current = rec;
      speech.current = { started: false, lastLoud: 0, begunAt: Date.now() };
      rec.start();
      setPhaseSafe("listening");

      const data = new Uint8Array(analyserRef.current!.fftSize);
      stopMeter();
      meterRef.current = window.setInterval(() => {
        const analyser = analyserRef.current;
        const recorder = recRef.current;
        if (!analyser || !recorder || recorder.state !== "recording") return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(rms);
        const now = Date.now();
        const s = speech.current;
        if (!s.started) {
          if (rms >= SPEECH_START_RMS) {
            s.started = true;
            s.lastLoud = now;
          }
        } else {
          if (rms >= SPEECH_KEEP_RMS) s.lastLoud = now;
          const silentFor = now - s.lastLoud;
          const talkingFor = now - s.begunAt;
          if (silentFor >= SILENCE_MS || talkingFor >= MAX_UTTERANCE_MS) {
            recorder.stop();
          }
        }
      }, 90);
    } catch (e) {
      setErrorMsg("Microphone unavailable: " + (e as Error).message);
      setPhaseSafe("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendUtterance, setPhaseSafe, stopMeter]);

  // Start on mount; full cleanup on unmount.
  useEffect(() => {
    closedRef.current = false;
    void beginListening();
    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleOrbTap() {
    const p = phaseRef.current;
    if (p === "speaking") {
      // Interrupt the reply and talk again.
      stopPlayback();
      void beginListening();
    } else if (p === "listening") {
      // End the turn early if something was said.
      if (speech.current.started && recRef.current?.state === "recording") {
        recRef.current.stop();
      }
    } else if (p === "error") {
      setErrorMsg(null);
      void beginListening();
    }
  }

  function handleClose() {
    teardown();
    onClose();
  }

  const label =
    phase === "starting"
      ? "Starting…"
      : phase === "listening"
        ? speechDetectedLabel(level)
        : phase === "thinking"
          ? "Thinking…"
          : phase === "speaking"
            ? "Tap to interrupt"
            : (errorMsg ?? "Something went wrong — tap to retry");

  const orbScale =
    phase === "listening" ? 1 + Math.min(level * 2.2, 0.45) : 1;

  return (
    <div className="voice-overlay" role="dialog" aria-label="Voice conversation">
      <button className="voice-close" onClick={handleClose} aria-label="Exit voice mode">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      <div className="voice-center">
        <button
          className={`voice-orb ${phase}`}
          style={{ transform: `scale(${orbScale})` }}
          onClick={handleOrbTap}
          aria-label={label}
        />
        <div className={`voice-status ${phase === "error" ? "error" : ""}`}>{label}</div>
        {caption && phase === "speaking" && (
          <div className="voice-caption">{caption}</div>
        )}
      </div>

      <div className="voice-hint">
        {phase === "listening"
          ? "Speak, then pause — I'll answer. Tap the orb to send now."
          : phase === "speaking"
            ? ""
            : phase === "thinking"
              ? "Working on it…"
              : ""}
      </div>
    </div>
  );
}

function speechDetectedLabel(level: number): string {
  return level >= SPEECH_KEEP_RMS ? "Listening…" : "Listening — go ahead";
}
