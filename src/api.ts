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

export type Citation = { uri: string; title: string };

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  via_web?: boolean;
  /** Local user reaction on assistant messages: "like" | "dislike" */
  feedback?: "like" | "dislike";
};

export type FeedbackPayload = {
  rating?: "like" | "dislike";
  message: string;
  context?: string;
  email?: string;
};

export const submitFeedback = (body: FeedbackPayload) =>
  jpost<{ ok: true }>("/feedback", body);

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
  citations?: Citation[];
  via_web?: boolean;
};

export type VoiceChatResp = RAGChatResp & { transcript: string };

export type DocType = "transcript" | "cv" | "other";

export type DocumentAnalyzeResp = {
  doc_type: DocType;
  extracted: Record<string, unknown>;
  notes: string | null;
  advice: string;
  handbook_chunks_used: number;
};

// Back-compat alias for callers that still reference the old type name
export type TranscriptAnalyzeResp = DocumentAnalyzeResp;

export type RetrieveResp = {
  query: string;
  chunks: Array<Record<string, unknown>>;
};

// ── Auth token holder ────────────────────────────────────────────────────
// AuthProvider keeps this updated; the API client reads it for every request.
let _authToken: string | null = null;
export function setAuthToken(token: string | null) {
  _authToken = token;
}

// Callback the frontend wires up to surface quota exhaustion to the UI:
// - kind="anonymous" (HTTP 402) opens the login modal
// - kind="authenticated" (HTTP 429) shows a non-modal toast
type QuotaKind = "anonymous" | "authenticated";
export type QuotaExceeded = { kind: QuotaKind; limit: number; used: number; message: string };
let _onQuotaExceeded: ((info: QuotaExceeded) => void) | null = null;
export function setQuotaExceededHandler(fn: ((info: QuotaExceeded) => void) | null) {
  _onQuotaExceeded = fn;
}

export class QuotaExceededError extends Error {
  info: QuotaExceeded;
  constructor(info: QuotaExceeded) {
    super(info.message);
    this.info = info;
    this.name = "QuotaExceededError";
  }
}

function authHeaders(): HeadersInit {
  return _authToken ? { Authorization: `Bearer ${_authToken}` } : {};
}

async function handleAuthFailure(r: Response): Promise<never> {
  // Try to parse a structured detail (e.g. anonymous_quota_exceeded, user_quota_exceeded)
  let detail: unknown = null;
  try {
    detail = (await r.clone().json()).detail;
  } catch {
    /* fall through */
  }
  if ((r.status === 402 || r.status === 429) && detail && typeof detail === "object") {
    const d = detail as Partial<QuotaExceeded> & { code?: string };
    const kind: QuotaKind = r.status === 429 ? "authenticated" : "anonymous";
    const fallback =
      kind === "authenticated"
        ? "You've hit today's message limit. Try again later."
        : "You've used your free messages. Sign in with Google to keep going.";
    const info: QuotaExceeded = {
      kind,
      limit: d.limit ?? 0,
      used: d.used ?? 0,
      message: d.message ?? fallback,
    };
    _onQuotaExceeded?.(info);
    throw new QuotaExceededError(info);
  }
  throw new Error((await r.text()) || r.statusText);
}

async function jpost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) return handleAuthFailure(r);
  return r.json();
}

async function fpost<T>(path: string, fd: FormData): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: fd,
    headers: authHeaders(),
  });
  if (!r.ok) return handleAuthFailure(r);
  return r.json();
}

export const health = () => fetch(`${API_BASE}/health`).then((r) => r.json());

export type QuotaStatus =
  | { authenticated: true }
  | { authenticated: false; limit: number; used: number; remaining: number };

export const fetchQuotaStatus = async (): Promise<QuotaStatus> => {
  const r = await fetch(`${API_BASE}/auth/quota`, { headers: authHeaders() });
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
};

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

export function analyzeDocument(file: File, notes?: string) {
  const fd = new FormData();
  fd.append("file", file);
  if (notes && notes.trim()) fd.append("notes", notes);
  return fpost<DocumentAnalyzeResp>("/document/analyze", fd);
}

export function analyzeCv(file: File, notes?: string) {
  const fd = new FormData();
  fd.append("file", file);
  if (notes && notes.trim()) fd.append("notes", notes);
  return fpost<DocumentAnalyzeResp>("/cv/analyze", fd);
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
