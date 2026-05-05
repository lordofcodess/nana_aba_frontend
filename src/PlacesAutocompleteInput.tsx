import { useEffect, useId, useRef, useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";

export type Picked = {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  onPick: (picked: Picked) => void;
  placeholder?: string;
  disabled?: boolean;
};

// UG Legon centre — bias predictions toward campus.
const UG_CENTER = { lat: 5.6510, lng: -0.1865 };
const UG_RADIUS_M = 2000;

type Suggestion = {
  placeId: string;
  mainText: string;
  secondaryText: string;
  // The original placePrediction object — needed to fetch full Place details.
  raw: google.maps.places.PlacePrediction;
};

export default function PlacesAutocompleteInput({
  value,
  onChange,
  onPick,
  placeholder,
  disabled,
}: Props) {
  const places = useMapsLibrary("places");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const listId = useId();

  // Refresh the session token after each pick, and lazily on first use.
  useEffect(() => {
    if (places && !sessionTokenRef.current) {
      sessionTokenRef.current = new places.AutocompleteSessionToken();
    }
  }, [places]);

  useEffect(() => {
    if (!places) {
      setStatusMsg("Loading Google Maps…");
      return;
    }
    setStatusMsg(null);
    const trimmed = value.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const req: google.maps.places.AutocompleteRequest = {
          input: trimmed,
          sessionToken: sessionTokenRef.current ?? undefined,
          locationBias: {
            center: UG_CENTER,
            radius: UG_RADIUS_M,
          },
          includedRegionCodes: ["gh"],
        };
        const { suggestions: raw } =
          await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
        if (cancelled) return;
        const mapped: Suggestion[] = [];
        for (const s of raw) {
          const p = s.placePrediction;
          if (!p || !p.placeId) continue;
          const main = p.mainText?.toString() || p.text?.toString() || "";
          const secondary = p.secondaryText?.toString() || "";
          mapped.push({
            placeId: p.placeId,
            mainText: main,
            secondaryText: secondary,
            raw: p,
          });
        }
        // eslint-disable-next-line no-console
        console.debug("[autocomplete]", { input: trimmed, count: mapped.length });
        if (mapped.length > 0) {
          setSuggestions(mapped);
          setHighlight(0);
          setStatusMsg(null);
        } else {
          setSuggestions([]);
          setStatusMsg("No matches");
        }
      } catch (e) {
        if (cancelled) return;
        const msg = (e as Error)?.message || String(e);
        // eslint-disable-next-line no-console
        console.error("[autocomplete] error:", e);
        setSuggestions([]);
        setStatusMsg(`Places error: ${msg}`);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [places, value]);

  async function pick(s: Suggestion) {
    if (!places) return;
    try {
      const place = s.raw.toPlace();
      await place.fetchFields({ fields: ["displayName", "location", "id"] });
      const lat = place.location?.lat();
      const lng = place.location?.lng();
      if (lat == null || lng == null) {
        setStatusMsg("Selected place has no coordinates");
        return;
      }
      const picked: Picked = {
        placeId: place.id || s.placeId,
        name: place.displayName || s.mainText,
        lat,
        lng,
      };
      onChange(picked.name);
      onPick(picked);
      // Start a fresh session for the next query (Google billing model).
      sessionTokenRef.current = new places.AutocompleteSessionToken();
      setOpen(false);
      setSuggestions([]);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[autocomplete] fetchFields error:", e);
      setStatusMsg(`Couldn't load place: ${(e as Error).message}`);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="places-autocomplete">
      <input
        className="places-autocomplete-input"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        disabled={disabled || !places}
        autoComplete="off"
        aria-controls={listId}
      />
      {open && (suggestions.length > 0 || statusMsg) && (
        <ul id={listId} className="places-autocomplete-menu" role="listbox">
          {suggestions.length === 0 && statusMsg && (
            <li className="places-pred-status" aria-disabled>
              {statusMsg}
            </li>
          )}
          {suggestions.slice(0, 5).map((s, i) => (
            <li
              key={s.placeId}
              role="option"
              aria-selected={i === highlight}
              className={i === highlight ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              <div className="places-pred-main">{s.mainText}</div>
              {s.secondaryText && (
                <div className="places-pred-secondary">{s.secondaryText}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
