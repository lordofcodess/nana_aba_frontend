import { useEffect, useRef, useState } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import { GOOGLE_MAPS_KEY, rewriteSteps } from "./api";
import DirectionsRouteCard from "./DirectionsRouteCard";
import PlacesAutocompleteInput, { type Picked } from "./PlacesAutocompleteInput";
import {
  deriveTitle,
  emptyThread,
  type DirectionsMsg,
  type DirectionsRoute,
  type DirectionsThread,
} from "./directionsStorage";

type Props = {
  threads: DirectionsThread[];
  setThreads: React.Dispatch<React.SetStateAction<DirectionsThread[]>>;
  activeId: string;
  setActiveId: (id: string) => void;
  onOpenSidebar?: () => void;
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function fmtDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function buildDeeplink(from: Picked, to: Picked): string {
  const params = new URLSearchParams({
    api: "1",
    origin: from.name,
    origin_place_id: from.placeId,
    destination: to.name,
    destination_place_id: to.placeId,
    travelmode: "walking",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// --- Routes API (REST) types and helper -----------------------------------
//
// We call routes.googleapis.com directly instead of the legacy DirectionsService
// because the legacy "Directions API" backend isn't enabled (Google steers new
// projects to Routes API). Same Maps Platform key — URL-restricted.

type RoutesApiStep = {
  navigationInstruction?: { instructions?: string };
  distanceMeters?: number;
};

type RoutesApiLeg = {
  steps?: RoutesApiStep[];
};

type RoutesApiRoute = {
  duration?: string;            // e.g. "245s"
  distanceMeters?: number;
  polyline?: { encodedPolyline?: string };
  legs?: RoutesApiLeg[];
};

type RoutesApiResponse = { routes?: RoutesApiRoute[] };

const ROUTES_FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.polyline.encodedPolyline",
  "routes.legs.steps.navigationInstruction",
  "routes.legs.steps.distanceMeters",
].join(",");

async function computeWalkingRouteREST(
  from: Picked,
  to: Picked,
  apiKey: string,
): Promise<RoutesApiResponse> {
  const r = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": ROUTES_FIELD_MASK,
      },
      body: JSON.stringify({
        origin: { placeId: from.placeId },
        destination: { placeId: to.placeId },
        travelMode: "WALK",
        languageCode: "en",
        units: "METRIC",
      }),
    },
  );
  if (!r.ok) {
    let detail = "";
    try {
      const errBody = await r.json();
      detail = errBody?.error?.message || JSON.stringify(errBody);
    } catch {
      detail = await r.text();
    }
    throw new Error(`Routes API ${r.status}: ${detail}`);
  }
  return r.json() as Promise<RoutesApiResponse>;
}

function parseDurationSec(duration: string | undefined): number {
  if (!duration) return 0;
  const m = duration.match(/^(\d+(?:\.\d+)?)s$/);
  return m ? Math.round(parseFloat(m[1])) : 0;
}

function DirectionsTabInner({
  threads,
  setThreads,
  activeId,
  setActiveId,
  onOpenSidebar,
}: Props) {
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [from, setFrom] = useState<Picked | null>(null);
  const [to, setTo] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const active = threads.find((t) => t.id === activeId) ?? threads[0];
  const messages = active.messages;
  const empty = messages.length === 0;

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  function mutateActive(updater: (prev: DirectionsMsg[]) => DirectionsMsg[]) {
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id !== active.id) return t;
        const next = updater(t.messages);
        return { ...t, messages: next, title: deriveTitle(next), updatedAt: Date.now() };
      }),
    );
  }

  function newThread() {
    const t = emptyThread();
    setThreads((prev) => [t, ...prev]);
    setActiveId(t.id);
    setFromText("");
    setToText("");
    setFrom(null);
    setTo(null);
    setError(null);
  }

  async function compute() {
    if (!from || !to || busy) return;
    setError(null);
    setBusy(true);

    const userMsg = `${from.name} → ${to.name}`;
    mutateActive((prev) => [...prev, { role: "user", content: userMsg }]);

    try {
      const routeRaw = await computeWalkingRouteREST(from, to, GOOGLE_MAPS_KEY);
      const r = routeRaw.routes?.[0];
      if (!r) throw new Error("No walking route found between those places.");
      const leg = r.legs?.[0];
      if (!leg) throw new Error("Route has no legs.");

      const rawSteps: string[] = (leg.steps || []).map((s) => {
        const text = stripHtml(s.navigationInstruction?.instructions || "");
        const dist = s.distanceMeters ?? 0;
        if (dist > 0) {
          if (dist < 1000) return `${text} (~${dist} m)`;
          return `${text} (~${(dist / 1000).toFixed(1)} km)`;
        }
        return text;
      });

      const totalMeters = r.distanceMeters ?? 0;
      const totalSeconds = parseDurationSec(r.duration);
      const distanceLabel = fmtDistance(totalMeters);
      const durationMinutes = Math.max(1, Math.round(totalSeconds / 60));

      // Backend NL rewrite — preserves road names/distances, weaves in landmarks.
      let prettySteps: string[] = rawSteps;
      try {
        const resp = await rewriteSteps({
          raw_steps: rawSteps,
          from_name: from.name,
          to_name: to.name,
          distance_label: distanceLabel,
          duration_minutes: durationMinutes,
        });
        if (Array.isArray(resp.steps) && resp.steps.length === rawSteps.length) {
          prettySteps = resp.steps;
        }
      } catch (e) {
        console.warn("rewrite-steps failed, using raw steps:", e);
      }

      const route: DirectionsRoute = {
        fromName: from.name,
        toName: to.name,
        fromPlaceId: from.placeId,
        toPlaceId: to.placeId,
        fromLat: from.lat,
        fromLng: from.lng,
        toLat: to.lat,
        toLng: to.lng,
        distanceLabel,
        distanceMeters: totalMeters,
        durationMinutes,
        durationSeconds: totalSeconds,
        steps: prettySteps,
        encodedPolyline: r.polyline?.encodedPolyline || "",
        deeplinkUrl: buildDeeplink(from, to),
      };

      mutateActive((prev) => [
        ...prev,
        { role: "assistant", content: prettySteps.join(" "), route },
      ]);
      // Reset composer for the next query
      setFromText("");
      setToText("");
      setFrom(null);
      setTo(null);
    } catch (e) {
      const msg = (e as Error).message || "Could not compute the route.";
      mutateActive((prev) => [
        ...prev,
        { role: "assistant", content: msg, error: true },
      ]);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="directions-tab">
      <header className="directions-header">
        {onOpenSidebar && (
          <button
            className="directions-menu"
            onClick={onOpenSidebar}
            aria-label="Open directions threads"
            title="Threads"
          >
            ☰
          </button>
        )}
        <div className="directions-header-title">{active.title}</div>
        <button
          className="directions-new-thread"
          onClick={newThread}
          aria-label="New directions thread"
          title="New thread"
        >
          +
        </button>
      </header>

      <div className="directions-scroller" ref={scrollerRef}>
        {empty ? (
          <div className="directions-hero">
            <h2 className="directions-title">Where to?</h2>
            <p className="directions-subtitle">
              Pick your starting point and destination. We'll draw the walking
              route and explain it in plain English.
            </p>
          </div>
        ) : (
          <div className="directions-messages">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="directions-msg user">
                  <div className="directions-msg-bubble">{m.content}</div>
                </div>
              ) : "route" in m ? (
                <div key={i} className="directions-msg assistant">
                  <DirectionsRouteCard route={m.route} />
                </div>
              ) : (
                <div key={i} className="directions-msg assistant">
                  <div className="directions-msg-bubble error">{m.content}</div>
                </div>
              ),
            )}
            {busy && (
              <div className="directions-msg assistant">
                <div className="directions-msg-bubble typing">Computing route…</div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && !busy && <div className="directions-error">{error}</div>}

      <div className="directions-composer">
        <PlacesAutocompleteInput
          value={fromText}
          onChange={(v) => {
            setFromText(v);
            setFrom(null);
          }}
          onPick={(p) => setFrom(p)}
          placeholder="From (e.g. Volta Hall)"
          disabled={busy}
        />
        <PlacesAutocompleteInput
          value={toText}
          onChange={(v) => {
            setToText(v);
            setTo(null);
          }}
          onPick={(p) => setTo(p)}
          placeholder="To (e.g. Computer Science)"
          disabled={busy}
        />
        <button
          className="directions-go"
          onClick={compute}
          disabled={!from || !to || busy}
        >
          {busy ? "…" : "Get directions"}
        </button>
      </div>
    </div>
  );
}

export default function DirectionsTab(props: Props) {
  if (!GOOGLE_MAPS_KEY) {
    return (
      <div className="directions-tab">
        <div className="directions-error" style={{ margin: 16 }}>
          Set <code>VITE_GOOGLE_MAPS_KEY</code> in <code>.env</code> to enable the
          Directions tab. The key needs Maps JavaScript API + Places API enabled.
        </div>
      </div>
    );
  }
  return (
    <APIProvider apiKey={GOOGLE_MAPS_KEY} libraries={["places", "geometry"]}>
      <DirectionsTabInner {...props} />
    </APIProvider>
  );
}
