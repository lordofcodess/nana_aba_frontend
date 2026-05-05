import { useEffect, useMemo } from "react";
import { Map, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import type { DirectionsRoute } from "./directionsStorage";

type Props = { route: DirectionsRoute };

function RouteOverlay({ route }: Props) {
  const map = useMap();
  const geometry = useMapsLibrary("geometry");

  useEffect(() => {
    if (!map || !geometry) return;
    const path = google.maps.geometry.encoding.decodePath(route.encodedPolyline);
    const polyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: "#1976d2",
      strokeOpacity: 0.9,
      strokeWeight: 5,
      map,
    });
    const startMarker = new google.maps.Marker({
      position: { lat: route.fromLat, lng: route.fromLng },
      map,
      label: { text: "A", color: "white", fontWeight: "600" },
    });
    const endMarker = new google.maps.Marker({
      position: { lat: route.toLat, lng: route.toLng },
      map,
      label: { text: "B", color: "white", fontWeight: "600" },
    });

    const bounds = new google.maps.LatLngBounds();
    path.forEach((p) => bounds.extend(p));
    bounds.extend({ lat: route.fromLat, lng: route.fromLng });
    bounds.extend({ lat: route.toLat, lng: route.toLng });
    map.fitBounds(bounds, 60);

    return () => {
      polyline.setMap(null);
      startMarker.setMap(null);
      endMarker.setMap(null);
    };
  }, [map, geometry, route]);

  return null;
}

export default function DirectionsRouteCard({ route }: Props) {
  const center = useMemo(
    () => ({
      lat: (route.fromLat + route.toLat) / 2,
      lng: (route.fromLng + route.toLng) / 2,
    }),
    [route.fromLat, route.fromLng, route.toLat, route.toLng],
  );

  return (
    <div className="directions-card">
      <div className="directions-route-header">
        <div className="directions-route-line">
          <span className="directions-pin from">
            <span className="dot" />
            {route.fromName}
          </span>
          <span className="directions-arrow">→</span>
          <span className="directions-pin to">
            <span className="dot" />
            {route.toName}
          </span>
        </div>
        <div className="directions-meta">
          <span>{route.distanceLabel}</span>
          {route.durationMinutes ? <span> · {route.durationMinutes} min walk</span> : null}
        </div>
      </div>

      <div className="directions-map">
        <Map
          defaultCenter={center}
          defaultZoom={15}
          gestureHandling="cooperative"
          disableDefaultUI={false}
          style={{ width: "100%", height: "100%" }}
        >
          <RouteOverlay route={route} />
        </Map>
      </div>

      <ol className="directions-steps">
        {route.steps.map((step, i) => (
          <li key={i}>
            <span className="directions-step-num">{i + 1}</span>
            <span className="directions-step-text">{step}</span>
          </li>
        ))}
      </ol>

      <a
        className="directions-open-maps"
        href={route.deeplinkUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open in Google Maps
      </a>
    </div>
  );
}
