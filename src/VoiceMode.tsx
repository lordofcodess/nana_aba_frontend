// ChatGPT-style voice-to-voice overlay.
//
// Loop: auto-listen → detect end of speech (silence) → send audio to
// /voice/converse → play the spoken reply → auto-listen again. Tap the orb to
// interrupt (while speaking) or end your turn early (while talking). X exits.
// Voice mode owns its own short-lived conversation. It never reads or mutates
// the regular text-chat thread.

import { useCallback, useEffect, useRef, useState } from "react";
import { voiceConverse, ragChatStream, ttsSpeak, type ChatMsg } from "./api";
import "./VoiceMode.css";
import { requestVoiceMicrophone, withVoiceTimeout } from "./voiceRuntime";

type Phase = "starting" | "listening" | "thinking" | "speaking" | "error";

interface Props {
  onClose: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
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

export default function VoiceMode({ onClose, sidebarOpen, onToggleSidebar }: Props) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [level, setLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorStage, setErrorStage] = useState<"microphone" | "activation" | "request" | "playback">("microphone");
  const [draft, setDraft] = useState("");
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [turns, setTurns] = useState<ChatMsg[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRef = useRef<number | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const pendingAudioRef = useRef<ArrayBuffer | null>(null);
  const playbackGeneration = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const closedRef = useRef(false);
  const phaseRef = useRef<Phase>("starting");
  const historyRef = useRef<ChatMsg[]>([]);
  const speech = useRef({ started: false, lastLoud: 0, begunAt: 0 });
  const discardRef = useRef(false);
  const listeningGeneration = useRef(0);

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
    playbackGeneration.current++;
    const source = audioSourceRef.current;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
      audioSourceRef.current = null;
    }
  }, []);

  const teardown = useCallback(() => {
    closedRef.current = true;
    listeningGeneration.current++;
    stopMeter();
    stopPlayback();
    pendingAudioRef.current = null;
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
    analyserRef.current = null;
  }, [stopMeter, stopPlayback]);

  const playReply = useCallback(
    async (bytes: ArrayBuffer) => {
      stopPlayback();
      pendingAudioRef.current = bytes;
      const generation = playbackGeneration.current;
      setErrorMsg(null);
      setPhaseSafe("thinking");
      try {
        const context = audioCtxRef.current ?? (audioCtxRef.current = new AudioContext());
        // Run resume synchronously on an orb tap, before decoding/network awaits.
        await withVoiceTimeout(context.resume(), 5000, "Tap the orb to enable audio and play the reply.");
        const buffer = await withVoiceTimeout(context.decodeAudioData(bytes.slice(0)), 10000, "Audio took too long to load. Tap the orb to retry.");
        if (closedRef.current || generation !== playbackGeneration.current) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        audioSourceRef.current = source;
        source.onended = () => {
          if (generation !== playbackGeneration.current || closedRef.current) return;
          pendingAudioRef.current = null;
          stopPlayback();
          void beginListening();
        };
        source.start();
        setPhaseSafe("speaking");
      } catch {
        if (closedRef.current || generation !== playbackGeneration.current) return;
        stopPlayback();
        setErrorStage("playback");
        setErrorMsg("Tap the orb to play the reply again. Your conversation is saved on this screen.");
        setPhaseSafe("error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setPhaseSafe, stopPlayback],
  );

  const sendUtterance = useCallback(
    async (blob: Blob) => {
      setPhaseSafe("thinking");
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        // This endpoint already transcribes, answers, and generates audio.
        const resp = await voiceConverse(blob, historyRef.current, controller.signal);
        if (closedRef.current || controller.signal.aborted) return;
        const nextTurns: ChatMsg[] = [
          ...historyRef.current,
          { role: "user", content: resp.transcript },
          { role: "assistant", content: resp.answer, citations: resp.citations ?? [], via_web: resp.via_web },
        ];
        historyRef.current = nextTurns;
        setTurns(nextTurns);
        const binary = atob(resp.audio_b64);
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        void playReply(bytes.buffer);
      } catch (e) {
        if (closedRef.current || (e as Error).name === "AbortError") return;
        const msg = (e as Error).message || "Something went wrong";
        // Unintelligible / silent recordings: just listen again quietly.
        if (/silent|unintelligible/i.test(msg)) {
          beginListening();
          return;
        }
        setErrorStage("request");
        setErrorMsg(`I couldn’t finish that voice turn: ${msg}. Tap the orb to speak again, or type below.`);
        setPhaseSafe("error");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playReply, setPhaseSafe],
  );

  const beginListening = useCallback(async () => {
    if (closedRef.current) return;
    if (mutedRef.current) { setPhaseSafe("listening"); return; }
    const generation = ++listeningGeneration.current;
    const isCurrent = () => !closedRef.current && !mutedRef.current && generation === listeningGeneration.current;
    setErrorMsg(null);
    setPhaseSafe("starting");
    let stage: "microphone" | "activation" = "activation";
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        stage = "microphone";
        throw new Error("This browser cannot record audio. Try Safari or Chrome over HTTPS.");
      }
      const context = audioCtxRef.current ?? (audioCtxRef.current = new AudioContext());
      // Activate output before requesting permission: an orb tap's user gesture
      // is no longer available after awaiting getUserMedia in Safari.
      await withVoiceTimeout(context.resume(), 5000, "Tap the orb to activate voice audio.");
      if (!isCurrent()) return;
      stage = "microphone";
      if (!streamRef.current) {
        streamRef.current = await requestVoiceMicrophone(isCurrent);
      }
      if (!isCurrent()) return;
      if (!analyserRef.current) {
        const src = context.createMediaStreamSource(streamRef.current);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        analyserRef.current = analyser;
      }

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
            s.begunAt = now;
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
      if (closedRef.current || generation !== listeningGeneration.current) return;
      setErrorStage(stage);
      const name = (e as Error).name;
      setErrorMsg(stage === "activation" ? "Tap the orb to activate voice audio."
        : name === "NotAllowedError" ? "Allow microphone access in your browser, then tap the orb to retry."
        : name === "NotFoundError" ? "Connect a microphone, then tap the orb to retry."
        : name === "NotReadableError" ? "Your microphone is busy or unavailable. Close other recording apps, then retry."
        : "Microphone access didn’t finish. Check browser permissions, then tap the orb to retry.");
      setPhaseSafe("error");
    }
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
      pendingAudioRef.current = null;
      void beginListening();
    } else if (p === "listening") {
      // End the turn early if something was said.
      if (speech.current.started && recRef.current?.state === "recording") {
        recRef.current.stop();
      }
    } else if (p === "error" || p === "starting") {
      setErrorMsg(null);
      if (pendingAudioRef.current) void playReply(pendingAudioRef.current);
      else void beginListening();
    }
  }

  function handleClose() {
    teardown();
    onClose();
  }

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  function pauseRecording() {
    listeningGeneration.current++;
    stopMeter();
    const recorder = recRef.current;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    setLevel(0);
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next; });
    if (next) {
      pauseRecording();
      if (phaseRef.current === "starting") setPhaseSafe("listening");
    }
    else if (phaseRef.current === "listening" || phaseRef.current === "error") void beginListening();
  }

  async function sendText(event: React.FormEvent) {
    event.preventDefault();
    const query = draft.trim();
    if (!query || phaseRef.current === "thinking") return;
    pauseRecording();
    stopPlayback();
    pendingAudioRef.current = null;
    setDraft("");
    setErrorMsg(null);
    setPhaseSafe("thinking");
    const controller = new AbortController();
    abortRef.current = controller;
    const previous = historyRef.current;
    const userTurn: ChatMsg = { role: "user", content: query };
    let reply: ChatMsg = { role: "assistant", content: "" };
    setTurns([...previous, userTurn]);
    try {
      await ragChatStream(query, previous, "fast", event => {
        if (controller.signal.aborted || closedRef.current) return;
        if (event.type === "delta") reply = { ...reply, content: reply.content + event.text };
        if (event.type === "replace") reply = { ...reply, content: event.text };
        if (event.type === "meta") reply = { ...reply, citations: event.citations, via_web: event.via_web };
        setTurns([...previous, userTurn, reply]);
      }, controller.signal);
      if (controller.signal.aborted || closedRef.current) return;
      historyRef.current = [...previous, userTurn, reply];
      const blob = await ttsSpeak(reply.content, controller.signal);
      if (controller.signal.aborted || closedRef.current) return;
      const bytes = await blob.arrayBuffer();
      if (controller.signal.aborted || closedRef.current) return;
      void playReply(bytes);
    } catch {
      if (closedRef.current || controller.signal.aborted) return;
      setErrorStage("request");
      setErrorMsg("I couldn’t complete the spoken reply. You can type another message or tap the orb to speak.");
      setPhaseSafe("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
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
    <section className="voice-overlay" aria-label="Nana Aba Voice">
      <header className="voice-header">
        {!sidebarOpen && (
          <button className="voice-icon" type="button" onClick={onToggleSidebar} aria-label="Show sidebar" aria-expanded={false} title="Show sidebar">
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>
          </button>
        )}
        <h1>Nana Aba <span>Voice</span></h1>
      </header>
      <div className="voice-transcript" ref={transcriptRef} role="log" aria-label="Voice conversation">
        <div className="voice-messages">
          {turns.map((turn, index) => (
            <div className={`voice-turn ${turn.role}`} key={`${turn.role}-${index}`}>
              <p>{turn.content}</p>
              {turn.role === "assistant" && turn.content && (
                <button className="voice-copy voice-icon" aria-label={copied === index ? "Copied" : "Copy reply"} title={copied === index ? "Copied" : "Copy reply"}
                  onClick={() => { void navigator.clipboard.writeText(turn.content).then(() => setCopied(index)).catch(() => setCopied(null)); }}>
                  {copied === index ? <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg> : <svg viewBox="0 0 24 24"><rect x="4" y="7" width="13" height="14" rx="3" /><path d="M8 7V5a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3" /></svg>}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="voice-dock">
        <div className="voice-center">
          <button className={`voice-orb ${phase} ${muted ? "muted" : ""}`} style={{ transform: `scale(${orbScale})` }} onClick={handleOrbTap}
            aria-label={muted && phase === "listening" ? "Microphone muted" : label} title={label}>
            <span className="voice-orb-cloud" />
          </button>
          <div className={`voice-status ${phase === "error" ? "error" : ""}`} role="status">
            {phase === "error" ? (
              <span className="voice-error-message">
                <strong>{errorStage === "playback" ? "Reply audio paused" : errorStage === "request" ? "Voice reply interrupted" : errorStage === "activation" ? "Tap to start voice" : "Microphone unavailable"}</strong>
                <small>{errorMsg}</small>
              </span>
            ) : muted && phase === "listening" ? "Microphone muted" : phase === "thinking" ? "Thinking…" : phase === "starting" ? "Starting voice… Tap the orb if needed" : ""}
          </div>
        </div>
        <form className="voice-composer" onSubmit={sendText}>
          <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Type" aria-label="Message Nana Aba in this voice conversation" />
          {draft.trim() && <button className="voice-icon" type="submit" disabled={phase === "thinking"} aria-label="Send message"><svg viewBox="0 0 24 24"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>}
          <button className={`voice-icon voice-mic ${muted ? "is-muted" : ""}`} type="button" onClick={toggleMute} aria-label={muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={muted}>
            <svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-3 0h6" />{muted && <path className="voice-mic-slash" d="M3 3l18 18" />}</svg>
          </button>
          <button className="voice-close voice-icon" type="button" onClick={handleClose} aria-label="End voice conversation"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        </form>
      </div>
    </section>
  );
}

function speechDetectedLabel(level: number): string {
  return level >= SPEECH_KEEP_RMS ? "Listening…" : "Listening — go ahead";
}
