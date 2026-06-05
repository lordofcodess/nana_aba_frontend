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
  /** Optional user-supplied name; when set, overrides auto-derived title. */
  customTitle?: string;
};

const NANA_ABA_LOGO = "/logo.png";
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

function deriveTitle(messages: ChatMsg[], customTitle?: string): string {
  if (customTitle && customTitle.trim()) return customTitle.trim();
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
  pencil: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  ),
  refresh: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  ),
  thumbsUp: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
    </svg>
  ),
  thumbsDown: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
    </svg>
  ),
  share: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="11.49" />
    </svg>
  ),
  mail: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22 6 12 13 2 6" />
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
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
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

  function startEdit(idx: number, content: string) {
    setEditingIdx(idx);
    setEditDraft(content);
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditDraft("");
  }

  async function saveEdit(idx: number) {
    const text = editDraft.trim();
    setEditingIdx(null);
    setEditDraft("");
    if (!text || busy) return;
    // Truncate everything from this message onward, then re-send.
    mutateActive((prev) => prev.slice(0, idx));
    await send(text);
  }

  async function regenerate(assistantIdx: number) {
    if (busy) return;
    // Find the preceding user message; if none, nothing to regenerate.
    const userIdx = messages.slice(0, assistantIdx).map((m, i) => ({ m, i }))
      .reverse().find(({ m }) => m.role === "user");
    if (!userIdx) return;
    const userMsg = userIdx.m.content;
    // Drop the assistant message AND replay the user message via send().
    mutateActive((prev) => prev.slice(0, userIdx.i));
    await send(userMsg);
  }

  function toggleFeedback(idx: number, rating: "like" | "dislike") {
    const current = messages[idx]?.feedback;
    const next = current === rating ? undefined : rating;
    mutateActive((prev) =>
      prev.map((m, i) => (i !== idx ? m : { ...m, feedback: next })),
    );
    if (next === "dislike") {
      window.open(
        "https://forms.gle/QeGC7hcdQJNjQeJFA",
        "_blank",
        "noopener,noreferrer",
      );
    }
  }

  async function shareMessage(idx: number, content: string) {
    const text = stripMarkdown(content) || content;
    const shareData = {
      title: "From Nana Aba AI",
      text,
    };
    try {
      if (navigator.share && navigator.canShare?.(shareData) !== false) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      // user cancelled or share unavailable — fall through to copy
    }
    await copyMessage(idx, content);
  }

  function startRename(threadId: string, currentTitle: string) {
    setRenamingThreadId(threadId);
    setRenameDraft(currentTitle);
  }

  function cancelRename() {
    setRenamingThreadId(null);
    setRenameDraft("");
  }

  function saveRename(threadId: string) {
    const next = renameDraft.trim();
    setRenamingThreadId(null);
    setRenameDraft("");
    setThreads((prev) =>
      prev.map((t) =>
        t.id !== threadId
          ? t
          : {
              ...t,
              customTitle: next || undefined,
              title: next || deriveTitle(t.messages),
            },
      ),
    );
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
        const title = t.customTitle?.trim()
          ? t.customTitle.trim()
          : t.messages.length === 0 && next.length > 0
            ? deriveTitle(next)
            : t.title;
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
            <img src={NANA_ABA_LOGO} alt="" className="brand-logo" />
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
        <a
          className="feedback-cta"
          href="https://forms.gle/QeGC7hcdQJNjQeJFA"
          target="_blank"
          rel="noopener noreferrer"
        >
          {ICON.mail}
          <span>Send feedback</span>
        </a>
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
                  onClick={() => {
                    if (renamingThreadId !== t.id) selectThread(t.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(t.id, t.title);
                  }}
                >
                  <div className="thread-main">
                    {renamingThreadId === t.id ? (
                      <input
                        className="thread-rename-input"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => saveRename(t.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveRename(t.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <div className="thread-title">{t.title}</div>
                    )}
                    <div className="thread-when">{formatWhen(t.updatedAt)}</div>
                  </div>
                  <button
                    className="thread-rename"
                    title="Rename"
                    aria-label="Rename thread"
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(t.id, t.title);
                    }}
                  >
                    {ICON.pencil}
                  </button>
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
              <img src={NANA_ABA_LOGO} alt="" className="sidebar-toggle-logo" />
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
            <img src={NANA_ABA_LOGO} alt="Nana Aba" className="hero-logo" />
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
                    <img src={NANA_ABA_LOGO} alt="" className="msg-avatar" />
                  )}
                  <div className="msg-col">
                    {editingIdx === i && m.role === "user" ? (
                      <form
                        className="bubble bubble-edit"
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveEdit(i);
                        }}
                      >
                        <textarea
                          className="bubble-edit-input"
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={Math.min(8, Math.max(2, editDraft.split("\n").length))}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEdit();
                            } else if (
                              e.key === "Enter" &&
                              (e.metaKey || e.ctrlKey)
                            ) {
                              e.preventDefault();
                              saveEdit(i);
                            }
                          }}
                        />
                        <div className="bubble-edit-actions">
                          <button type="button" className="pill" onClick={cancelEdit}>
                            Cancel
                          </button>
                          <button type="submit" className="pill primary" disabled={busy || !editDraft.trim()}>
                            Save & resend
                          </button>
                        </div>
                      </form>
                    ) : (
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
                    )}
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
                      {m.role === "user" && (
                        <button
                          type="button"
                          className="icon-btn edit-btn"
                          onClick={() => startEdit(i, m.content)}
                          title="Edit message"
                          aria-label="Edit message"
                          disabled={busy}
                        >
                          {ICON.pencil}
                        </button>
                      )}
                      {m.role === "assistant" && (
                        <>
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
                          <button
                            type="button"
                            className={`icon-btn feedback-btn ${m.feedback === "like" ? "active" : ""}`}
                            onClick={() => toggleFeedback(i, "like")}
                            title={m.feedback === "like" ? "Liked" : "Good answer"}
                            aria-label="Like this answer"
                            aria-pressed={m.feedback === "like"}
                          >
                            {ICON.thumbsUp}
                          </button>
                          <button
                            type="button"
                            className={`icon-btn feedback-btn ${m.feedback === "dislike" ? "active down" : ""}`}
                            onClick={() => toggleFeedback(i, "dislike")}
                            title={m.feedback === "dislike" ? "Disliked" : "Bad answer"}
                            aria-label="Dislike this answer"
                            aria-pressed={m.feedback === "dislike"}
                          >
                            {ICON.thumbsDown}
                          </button>
                          <button
                            type="button"
                            className="icon-btn regen-btn"
                            onClick={() => regenerate(i)}
                            title="Regenerate response"
                            aria-label="Regenerate response"
                            disabled={busy}
                          >
                            {ICON.refresh}
                          </button>
                          <button
                            type="button"
                            className="icon-btn share-btn"
                            onClick={() => shareMessage(i, m.content)}
                            title="Share"
                            aria-label="Share message"
                          >
                            {ICON.share}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {busy && (
                <div className="msg assistant">
                  <img src={NANA_ABA_LOGO} alt="" className="msg-avatar" />
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
