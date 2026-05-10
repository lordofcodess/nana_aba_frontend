const env = import.meta.env as Record<string, string | undefined>;

function requireEnv(name: "VITE_API_BASE" | "VITE_TTS_BASE") {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const API_BASE = requireEnv("VITE_API_BASE");
const TTS_BASE = requireEnv("VITE_TTS_BASE");

export type ChatMsg = { role: "user" | "assistant"; content: string };

export type Source = {
  source_file?: string | null;
  level?: number | null;
  department?: string | null;
};

export type ChatMode = "fast" | "thinking";

export type RAGChatResp = {
  query: string;
  answer: string;
  sources: Source[];
  mode?: ChatMode | null;
};

export type VoiceChatResp = RAGChatResp & { transcript: string };

export type TranscriptAnalyzeResp = {
  extracted: Record<string, unknown>;
  notes: string | null;
  advice: string;
  handbook_chunks_used: number;
};

export type RetrieveResp = {
  query: string;
  chunks: Array<Record<string, unknown>>;
};

async function jpost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
}

async function fpost<T>(path: string, fd: FormData): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
}

export const health = () => fetch(`${API_BASE}/health`).then((r) => r.json());

export const ragChat = (
  query: string,
  history: ChatMsg[] = [],
  mode: ChatMode = "fast",
  topK?: number,
) => jpost<RAGChatResp>("/chat", { query, history, mode, ...(topK ? { top_k: topK } : {}) });

export const ragRetrieve = (query: string, topK = 10) =>
  jpost<RetrieveResp>("/retrieve", { query, top_k: topK });

export function voiceChat(blob: Blob, filename = "voice.webm", topK = 10) {
  const fd = new FormData();
  fd.append("file", blob, filename);
  fd.append("top_k", String(topK));
  return fpost<VoiceChatResp>("/voice/chat", fd);
}

export function analyzeTranscript(file: File, notes?: string) {
  const fd = new FormData();
  fd.append("file", file);
  if (notes && notes.trim()) fd.append("notes", notes);
  return fpost<TranscriptAnalyzeResp>("/transcript/analyze", fd);
}

export const GOOGLE_MAPS_KEY = (env.VITE_GOOGLE_MAPS_KEY ?? "").trim();

export type RewriteStepsReq = {
  raw_steps: string[];
  from_name: string;
  to_name: string;
  distance_label: string;
  duration_minutes: number;
};

export type RewriteStepsResp = { steps: string[] };

export const rewriteSteps = (body: RewriteStepsReq) =>
  jpost<RewriteStepsResp>("/directions/rewrite-steps", body);

export async function ttsSpeak(
  text: string,
  language: string = "English",
  signal?: AbortSignal,
): Promise<Blob> {
  const fd = new FormData();
  fd.append("text", text);
  fd.append("language", language);
  const r = await fetch(`${TTS_BASE}/tts/form`, { method: "POST", body: fd, signal });
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.blob();
}
