import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ragChat,
  voiceChat,
  analyzeTranscript,
  ttsSpeak,
  type ChatMsg,
} from "./api";
import "./App.css";

type Thread = {
  id: string;
  title: string;
  messages: ChatMsg[];
  updatedAt: number;
};

const STORAGE_KEY = "nana_aba_threads_v1";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function newThreadId() {
  return "t_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function emptyThread(): Thread {
  return { id: newThreadId(), title: "New chat", messages: [], updatedAt: Date.now() };
}

function deriveTitle(messages: ChatMsg[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const clean = first.content.replace(/\s+/g, " ").trim();
  return clean.length > 38 ? clean.slice(0, 38) + "…" : clean || "New chat";
}

function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t) => t && typeof t.id === "string" && Array.isArray(t.messages),
    );
  } catch {
    return [];
  }
}

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*\|.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatWhen(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

const EXAMPLES = [
  "What are the general requirements to do a major minor in Computer Science and Statistics?",
  "Who is the vice chancellor of the University of Ghana?",
  "What is the promotion criteria from Lecturer to Senior Lecturer?",
  "What is the cutoff point for BSc. Biomedical Engineering?",
];

export default function App() {
  const [threads, setThreads] = useState<Thread[]>(() => {
    const loaded = loadThreads();
    return loaded.length ? loaded : [emptyThread()];
  });
  const [activeId, setActiveId] = useState<string>(threads[0].id);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ttsLoadingIdx, setTtsLoadingIdx] = useState<number | null>(null);
  const [ttsPlayingIdx, setTtsPlayingIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);

  const active = threads.find((t) => t.id === activeId) ?? threads[0];
  const messages = active.messages;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    setTtsPlayingIdx(null);
    setTtsLoadingIdx(null);
  }

  async function copyMessage(idx: number, content: string) {
    const text = stripMarkdown(content) || content;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        setError("Copy failed");
      }
      document.body.removeChild(ta);
    }
    setCopiedIdx(idx);
    window.setTimeout(
      () => setCopiedIdx((cur) => (cur === idx ? null : cur)),
      1200,
    );
  }

  async function toggleTts(idx: number, content: string) {
    if (ttsPlayingIdx === idx || ttsLoadingIdx === idx) {
      stopAudio();
      return;
    }
    stopAudio();
    const cleaned = stripMarkdown(content);
    if (!cleaned) return;

    // Create + unlock the Audio element SYNCHRONOUSLY while we still hold the
    // user gesture. Safari loses the gesture grant across the `await fetch`
    // below, so we prime playback now with a silent data URI and swap the
    // real source in once the TTS blob arrives.
    const audio = new Audio();
    audio.preload = "auto";
    audio.src =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
    audio.play().then(() => audio.pause()).catch(() => {});
    audioRef.current = audio;

    const controller = new AbortController();
    ttsAbortRef.current = controller;
    setTtsLoadingIdx(idx);
    try {
      const blob = await ttsSpeak(cleaned, "English", controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      audio.onended = () => {
        if (audioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        }
        audioRef.current = null;
        setTtsPlayingIdx(null);
      };
      audio.onerror = () => {
        setError("Audio playback failed");
        stopAudio();
      };
      audio.src = url;
      setTtsLoadingIdx(null);
      setTtsPlayingIdx(idx);
      try {
        await audio.play();
      } catch (playErr) {
        setError("Audio playback blocked: " + (playErr as Error).message);
        stopAudio();
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError("TTS failed: " + (e as Error).message);
      setTtsLoadingIdx(null);
    } finally {
      if (ttsAbortRef.current === controller) ttsAbortRef.current = null;
    }
  }

  function mutateActive(updater: (prev: ChatMsg[]) => ChatMsg[]) {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== activeId) return t;
        const next = updater(t.messages);
        const title = t.messages.length === 0 && next.length > 0 ? deriveTitle(next) : t.title;
        return { ...t, messages: next, title, updatedAt: Date.now() };
      }),
    );
  }

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput("");
    setError(null);
    const historySnapshot = messages;
    mutateActive((prev) => [...prev, { role: "user", content: message }]);
    setBusy(true);
    try {
      const resp = await ragChat(message, historySnapshot);
      mutateActive((prev) => [...prev, { role: "assistant", content: resp.answer }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const notes = input.trim();
    setInput("");
    setError(null);
    const userMsg: ChatMsg = {
      role: "user",
      content: notes ? `📄 Uploaded ${f.name}\n\n${notes}` : `📄 Uploaded ${f.name}`,
    };
    mutateActive((prev) => [...prev, userMsg]);
    setBusy(true);
    try {
      const resp = await analyzeTranscript(f, notes || undefined);
      mutateActive((prev) => [...prev, { role: "assistant", content: resp.advice }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function newThread() {
    stopAudio();
    const t = emptyThread();
    setThreads((prev) => [t, ...prev]);
    setActiveId(t.id);
    setInput("");
    setError(null);
    setSidebarOpen(false);
  }

  function selectThread(id: string) {
    setSidebarOpen(false);
    if (id === activeId) return;
    stopAudio();
    setActiveId(id);
    setInput("");
    setError(null);
  }

  function deleteThread(id: string) {
    setThreads((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (filtered.length === 0) {
        const fresh = emptyThread();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(filtered[0].id);
      return filtered;
    });
  }

  async function toggleRecord() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setBusy(true);
        try {
          const resp = await voiceChat(blob);
          mutateActive((prev) => [
            ...prev,
            { role: "user", content: resp.transcript },
            { role: "assistant", content: resp.answer },
          ]);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      setError("Microphone access denied: " + (err as Error).message);
    }
  }

  const empty = messages.length === 0;
  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

  const composer = (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="composer-top">
        <button
          type="button"
          className={`mic-inline ${recording ? "rec" : ""}`}
          onClick={toggleRecord}
          disabled={busy && !recording}
          title={recording ? "Stop recording" : "Voice question"}
        >
          {recording ? "■" : "🎤"}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask AI a question or make a request."
          disabled={busy}
        />
      </div>
      <div className="composer-bottom">
        <label className="pill">
          📎 Analyze transcript
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            hidden
            onChange={onFile}
            disabled={busy}
          />
        </label>
        <button type="submit" className="send-btn" disabled={busy || !input.trim()}>
          ↑
        </button>
      </div>
    </form>
  );

  return (
    <div className="app">
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head">
          <div className="brand">Nana Aba</div>
          <button className="new-btn" onClick={newThread}>+ New</button>
        </div>
        <div className="thread-list">
          {sortedThreads.map((t) => (
            <div
              key={t.id}
              className={`thread-item ${t.id === activeId ? "active" : ""}`}
              onClick={() => selectThread(t.id)}
            >
              <div className="thread-main">
                <div className="thread-title">{t.title}</div>
                <div className="thread-when">{formatWhen(t.updatedAt)}</div>
              </div>
              <button
                className="thread-del"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteThread(t.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="main">
        <header className="mobile-topbar">
          <button
            className="menu-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="mobile-title">{active.title}</div>
          <button className="menu-btn" onClick={newThread} aria-label="New thread">
            +
          </button>
        </header>
        {empty ? (
          <section className="hero">
            <h1 className="greet">
              {greeting()}
              <br />
              What's on <span className="accent">your mind?</span>
            </h1>
            {composer}
            <div className="examples">
              {EXAMPLES.map((s) => (
                <button key={s} className="example-card" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <>
            <main className="chat" ref={scrollerRef}>
              {messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <div className="msg-col">
                    <div className="bubble">
                      {m.role === "assistant" ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {m.content}
                        </ReactMarkdown>
                      ) : (
                        m.content
                      )}
                    </div>
                    <div className="msg-actions">
                      <button
                        type="button"
                        className={`copy-btn ${copiedIdx === i ? "copied" : ""}`}
                        onClick={() => copyMessage(i, m.content)}
                        title={copiedIdx === i ? "Copied" : "Copy"}
                      >
                        {copiedIdx === i ? "✓" : "📋"}
                      </button>
                      {m.role === "assistant" && (
                        <button
                          type="button"
                          className={`tts-btn ${ttsPlayingIdx === i ? "playing" : ""} ${ttsLoadingIdx === i ? "loading" : ""}`}
                          onClick={() => toggleTts(i, m.content)}
                          title={
                            ttsPlayingIdx === i
                              ? "Stop"
                              : ttsLoadingIdx === i
                                ? "Loading…"
                                : "Read aloud"
                          }
                        >
                          {ttsLoadingIdx === i ? "…" : ttsPlayingIdx === i ? "⏹" : "🔊"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {busy && (
                <div className="msg assistant">
                  <div className="bubble typing">
                    <span className="thinking-label">Thinking</span>
                    <span className="dots">
                      <span /><span /><span />
                    </span>
                  </div>
                </div>
              )}
            </main>
            {error && <div className="error">{error}</div>}
            <div className="composer-wrap">{composer}</div>
          </>
        )}
      </div>
    </div>
  );
}
