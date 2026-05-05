// Persistent storage for the Directions chat.
// Mirrors the Nana Aba chat (threads → messages → localStorage) so the UX
// is consistent across the two features.

export type DirectionsRoute = {
  fromName: string;
  toName: string;
  fromPlaceId: string | null;
  toPlaceId: string | null;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  distanceLabel: string;       // e.g. "1.0 km"
  distanceMeters: number;
  durationMinutes: number;
  durationSeconds: number;
  // Steps as natural-language sentences from /directions/rewrite-steps,
  // OR raw "Head south on Volta Rd for 100 m" if rewrite failed.
  steps: string[];
  // Encoded polyline so we can re-render the map after a reload without
  // re-running DirectionsService.
  encodedPolyline: string;
  // Pre-built deep link to open in Google Maps.
  deeplinkUrl: string;
};

export type DirectionsMsg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; route: DirectionsRoute }
  | { role: "assistant"; content: string; error: true };

export type DirectionsThread = {
  id: string;
  title: string;
  messages: DirectionsMsg[];
  updatedAt: number;
};

const STORAGE_KEY = "directions_threads_v1";

export function newThreadId(): string {
  return "d_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function emptyThread(): DirectionsThread {
  return {
    id: newThreadId(),
    title: "New directions",
    messages: [],
    updatedAt: Date.now(),
  };
}

export function loadThreads(): DirectionsThread[] {
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

export function saveThreads(threads: DirectionsThread[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

export function deriveTitle(messages: DirectionsMsg[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New directions";
  const clean = first.content.replace(/\s+/g, " ").trim();
  return clean.length > 38 ? clean.slice(0, 38) + "…" : clean || "New directions";
}
