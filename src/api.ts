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
  /** True when the assistant is asking a clarifying question, not answering. */
  probing?: boolean;
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
  // Prefer the API's human-readable `detail` over raw JSON in the error UI.
  const text = await r.text();
  let message = text || r.statusText;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.detail === "string") message = parsed.detail;
    else if (typeof parsed?.detail?.message === "string") message = parsed.detail.message;
  } catch {
    /* not JSON — use the raw text */
  }
  throw new Error(message);
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

export type StreamStage = "retrieving" | "generating" | "web_search";

export type ChatStreamEvent =
  | { type: "status"; stage: StreamStage }
  | { type: "delta"; text: string }
  | { type: "replace"; text: string }
  | {
      type: "meta";
      sources: RAGChatResp["sources"];
      probing: boolean;
      chitchat: boolean;
      citations: Citation[];
      via_web: boolean;
    }
  | { type: "error"; detail: string }
  | { type: "done" };

/** Streaming /chat: parses SSE events and invokes onEvent for each. */
export async function ragChatStream(
  query: string,
  history: ChatMsg[] = [],
  mode: ChatMode = "fast",
  onEvent: (ev: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      query,
      mode,
      history: history.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal,
  });
  if (!r.ok || !r.body) return handleAuthFailure(r);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, sep).trim();
      buf = buf.slice(sep + 2);
      if (!frame.startsWith("data:")) continue;
      let ev: ChatStreamEvent;
      try {
        ev = JSON.parse(frame.slice(5).trim());
      } catch {
        continue;
      }
      if (ev.type === "error") throw new Error(ev.detail || "Stream failed");
      onEvent(ev);
    }
  }
}

/** Transcribe a voice recording to text (no answer generated). */
export function transcribeVoice(blob: Blob, filename = "voice.webm") {
  const fd = new FormData();
  fd.append("file", blob, filename);
  return fpost<{ transcript: string }>("/transcribe", fd);
}

export const ragRetrieve = (query: string, topK = 10) =>
  jpost<RetrieveResp>("/retrieve", { query, top_k: topK });

export type VoiceConverseResp = {
  transcript: string;
  answer: string;
  via_web: boolean;
  audio_b64: string;
  mime: string;
  sample_rate: number;
};

/** Full voice-to-voice turn: audio in → {transcript, answer, spoken reply}. */
export async function voiceConverse(
  blob: Blob,
  history: ChatMsg[] = [],
  signal?: AbortSignal,
  filename = "voice.webm",
): Promise<VoiceConverseResp> {
  const fd = new FormData();
  fd.append("file", blob, filename);
  fd.append(
    "history",
    JSON.stringify(history.map((m) => ({ role: m.role, content: m.content }))),
  );
  fd.append("mode", "fast");
  const r = await fetch(`${API_BASE}/voice/converse`, {
    method: "POST",
    body: fd,
    headers: authHeaders(),
    signal,
  });
  if (!r.ok) return handleAuthFailure(r);
  return r.json();
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

// Locked-in voice preset. Leave any field as "" to let the backend use its
// own default. To pin a value, edit here — one place, one change.
const TTS_DEFAULTS = {
  ref_audio: "",
  ref_text: "",
  duration: "",
  speed: "",
};

export async function ttsSpeak(
  text: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const fd = new FormData();
  fd.append("text", text);
  fd.append("ref_audio", TTS_DEFAULTS.ref_audio);
  fd.append("ref_text", TTS_DEFAULTS.ref_text);
  fd.append("duration", TTS_DEFAULTS.duration);
  fd.append("speed", TTS_DEFAULTS.speed);
  const r = await fetch(`${TTS_BASE}/clone`, {
    method: "POST",
    body: fd,
    signal,
  });
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.blob();
}
