import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ragChat,
  voiceChat,
  analyzeDocument,
  ttsSpeak,
  type ChatMode,
  type ChatMsg,
} from "./api";
import DirectionsTab from "./DirectionsTab";
import {
  emptyThread as emptyDirThread,
  loadThreads as loadDirThreads,
  saveThreads as saveDirThreads,
  type DirectionsThread,
} from "./directionsStorage";
import "./App.css";

type Tab = "chat" | "directions";

type Thread = {
  id: string;
  title: string;
  messages: ChatMsg[];
  updatedAt: number;
};

const STORAGE_KEY = "nana_aba_threads_v1";
const MODE_KEY = "nana_aba_mode_v1";

function loadMode(): ChatMode {
  const v = localStorage.getItem(MODE_KEY);
  return v === "thinking" ? "thinking" : "fast";
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

const ICON = {
  panel: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  ),
  newChat: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  ),
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  speaker: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  ),
  stop: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  ),
  loading: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </svg>
  ),
  mic: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  ),
  recStop: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ),
  arrowUp: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  ),
  bolt: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  ),
  sparkles: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2z" />
      <path d="M19 14l.9 2.5L22 17.5l-2.1 1L19 21l-.9-2.5L16 17.5l2.1-1L19 14z" />
    </svg>
  ),
  paperclip: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  ),
  file: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  chevron: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  close: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};

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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 761;
  });
  const [tab, setTab] = useState<Tab>("chat");
  const [mode, setMode] = useState<ChatMode>(() => loadMode());
  const [dirThreads, setDirThreads] = useState<DirectionsThread[]>(() => {
    const loaded = loadDirThreads();
    return loaded.length ? loaded : [emptyDirThread()];
  });
  const [dirActiveId, setDirActiveId] = useState<string>(dirThreads[0].id);
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
    saveDirThreads(dirThreads);
  }, [dirThreads]);

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  function newDirThread() {
    const t = emptyDirThread();
    setDirThreads((prev) => [t, ...prev]);
    setDirActiveId(t.id);
    setSidebarOpen(false);
  }

  function selectDirThread(id: string) {
    setSidebarOpen(false);
    if (id === dirActiveId) return;
    setDirActiveId(id);
  }

  function deleteDirThread(id: string) {
    setDirThreads((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (filtered.length === 0) {
        const fresh = emptyDirThread();
        setDirActiveId(fresh.id);
        return [fresh];
      }
      if (id === dirActiveId) setDirActiveId(filtered[0].id);
      return filtered;
    });
  }

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
    if (busy) return;
    const message = (text ?? input).trim();

    // If a file is staged, route to document upload (with notes as the message).
    if (pendingFile) {
      const f = pendingFile;
      const notes = message;
      setInput("");
      setPendingFile(null);
      setError(null);
      const userMsg: ChatMsg = {
        role: "user",
        content: notes ? `📄 Uploaded ${f.name}\n\n${notes}` : `📄 Uploaded ${f.name}`,
      };
      mutateActive((prev) => [...prev, userMsg]);
      setBusy(true);
      try {
        const resp = await analyzeDocument(f, notes || undefined);
        const labelMap = { transcript: "transcript", cv: "CV", other: "document" } as const;
        const heading = `*Detected: ${labelMap[resp.doc_type]}.*\n\n`;
        mutateActive((prev) => [
          ...prev,
          { role: "assistant", content: heading + resp.advice },
        ]);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!message) return;
    setInput("");
    setError(null);
    const historySnapshot = messages;
    mutateActive((prev) => [...prev, { role: "user", content: message }]);
    setBusy(true);
    try {
      const resp = await ragChat(message, historySnapshot, mode);
      mutateActive((prev) => [
        ...prev,
        {
          role: "assistant",
          content: resp.answer,
          citations: resp.citations ?? [],
          via_web: resp.via_web ?? false,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setPendingFile(f);
    setError(null);
  }

  function newThread() {
    stopAudio();
    const t = emptyThread();
    setThreads((prev) => [t, ...prev]);
    setActiveId(t.id);
    setInput("");
    setPendingFile(null);
    setError(null);
    setSidebarOpen(false);
  }

  function selectThread(id: string) {
    setSidebarOpen(false);
    if (id === activeId) return;
    stopAudio();
    setActiveId(id);
    setInput("");
    setPendingFile(null);
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
            {
              role: "assistant",
              content: resp.answer,
              citations: resp.citations ?? [],
              via_web: resp.via_web ?? false,
            },
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
      {pendingFile && (
        <div className="staged-file" role="status" aria-live="polite">
          <span className="staged-file-icon" aria-hidden="true">{ICON.file}</span>
          <span className="staged-file-name" title={pendingFile.name}>
            {pendingFile.name}
          </span>
          <button
            type="button"
            className="staged-file-remove"
            onClick={() => setPendingFile(null)}
            aria-label="Remove staged file"
            title="Remove"
            disabled={busy}
          >
            {ICON.close}
          </button>
        </div>
      )}
      <div className="composer-top">
        <button
          type="button"
          className={`mic-inline ${recording ? "rec" : ""}`}
          onClick={toggleRecord}
          disabled={busy && !recording}
          title={recording ? "Stop recording" : "Voice question"}
          aria-label={recording ? "Stop recording" : "Voice question"}
        >
          {recording ? ICON.recStop : ICON.mic}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            pendingFile
              ? "Add context for this document (optional) and press send"
              : "Ask Nana Aba a question"
          }
          disabled={busy}
        />
      </div>
      <div className="composer-bottom">
        <div className={`pill mode-pill ${mode === "thinking" ? "mode-thinking" : "mode-fast"}`}>
          <span className="mode-icon" aria-hidden="true">
            {mode === "fast" ? ICON.bolt : ICON.sparkles}
          </span>
          <select
            className="mode-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as ChatMode)}
            disabled={busy}
            aria-label="Answer mode"
          >
            <option value="fast">Fast</option>
            <option value="thinking">Thinking</option>
          </select>
          <span aria-hidden="true" className="mode-caret">{ICON.chevron}</span>
        </div>
        <label className="pill attach-pill" title="Upload a transcript or CV (PDF or image). I'll figure out which it is.">
          <span className="attach-icon" aria-hidden="true">{ICON.paperclip}</span>
          <span>Analyze document</span>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            hidden
            onChange={onFile}
            disabled={busy}
          />
        </label>
        <button
          type="submit"
          className="send-btn"
          disabled={busy || (!input.trim() && !pendingFile)}
          aria-label="Send"
        >
          {ICON.arrowUp}
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
          <div className="brand">
            <img src="/logo.png" alt="" className="brand-logo" />
            <span>{tab === "directions" ? "Directions" : "Nana Aba"}</span>
          </div>
          <button
            type="button"
            className="sidebar-collapse"
            onClick={() => setSidebarOpen(false)}
            aria-label="Hide sidebar"
            title="Hide sidebar"
          >
            {ICON.panel}
          </button>
        </div>
        <button
          type="button"
          className="new-chat-row"
          onClick={tab === "directions" ? newDirThread : newThread}
        >
          {ICON.newChat}
          <span>New chat</span>
        </button>
        <div className="thread-list">
          {tab === "directions"
            ? [...dirThreads]
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((t) => (
                  <div
                    key={t.id}
                    className={`thread-item ${t.id === dirActiveId ? "active" : ""}`}
                    onClick={() => selectDirThread(t.id)}
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
                        deleteDirThread(t.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))
            : sortedThreads.map((t) => (
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
        <nav className="app-tabs" aria-label="Sections">
          {!sidebarOpen && (
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="Show sidebar"
              title="Show sidebar"
            >
              <img src="/logo.png" alt="" className="sidebar-toggle-logo" />
              <span className="sidebar-toggle-icon">{ICON.panel}</span>
            </button>
          )}
          <button
            className={tab === "chat" ? "active" : ""}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
          <button
            className={tab === "directions" ? "active" : ""}
            onClick={() => setTab("directions")}
          >
            Directions
          </button>
        </nav>
        {tab === "directions" ? (
          <DirectionsTab
            threads={dirThreads}
            setThreads={setDirThreads}
            activeId={dirActiveId}
            setActiveId={setDirActiveId}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        ) : empty ? (
          <section className="hero">
            <img src="/logo.png" alt="Nana Aba" className="hero-logo" />
            <h1 className="greet">
              Welcome to <span className="accent">Nana Aba AI</span>
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
                  {m.role === "assistant" && (
                    <img src="/logo.png" alt="" className="msg-avatar" />
                  )}
                  <div className="msg-col">
                    <div className="bubble">
                      {m.role === "assistant" ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {m.content}
                        </ReactMarkdown>
                      ) : (
                        m.content
                      )}
                      {m.role === "assistant" && m.via_web && (
                        <span className="via-web-badge" title="Answered from the live UG website">
                          from UG website
                        </span>
                      )}
                    </div>
                    {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                      <details className="msg-citations">
                        <summary>Sources ({m.citations.length})</summary>
                        <ul>
                          {m.citations.map((c) => (
                            <li key={c.uri}>
                              <a href={c.uri} target="_blank" rel="noopener noreferrer">
                                {c.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <div className="msg-actions">
                      <button
                        type="button"
                        className={`icon-btn copy-btn ${copiedIdx === i ? "copied" : ""}`}
                        onClick={() => copyMessage(i, m.content)}
                        title={copiedIdx === i ? "Copied" : "Copy"}
                        aria-label={copiedIdx === i ? "Copied" : "Copy message"}
                      >
                        {copiedIdx === i ? ICON.check : ICON.copy}
                      </button>
                      {m.role === "assistant" && (
                        <button
                          type="button"
                          className={`icon-btn tts-btn ${ttsPlayingIdx === i ? "playing" : ""} ${ttsLoadingIdx === i ? "loading" : ""}`}
                          onClick={() => toggleTts(i, m.content)}
                          title={
                            ttsPlayingIdx === i
                              ? "Stop"
                              : ttsLoadingIdx === i
                                ? "Loading…"
                                : "Read aloud"
                          }
                          aria-label={
                            ttsPlayingIdx === i
                              ? "Stop playback"
                              : "Read message aloud"
                          }
                        >
                          {ttsLoadingIdx === i
                            ? ICON.loading
                            : ttsPlayingIdx === i
                              ? ICON.stop
                              : ICON.speaker}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {busy && (
                <div className="msg assistant">
                  <img src="/logo.png" alt="" className="msg-avatar" />
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
