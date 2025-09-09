// components/Map.tsx
"use client";

import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import "leaflet/dist/leaflet.css";

/** Mantiene la mappa “in forma” su cambi centro/bounds e su resize */
function ResizeFix({
  center,
  bounds,
}: {
  center?: [number, number] | null;
  bounds?: [[number, number], [number, number]] | null;
}) {
  const map = useMap();

  useEffect(() => {
    // piccolo defer per assicurarsi che il container sia montato
    setTimeout(() => {
      if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
        const currentZoom = map.getZoom() || 12;
        map.setView(center, currentZoom);
      } else if (bounds) {
        map.fitBounds(bounds);
      }
      map.invalidateSize();
    }, 0);

    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [map, center?.[0], center?.[1], bounds?.[0]?.[0], bounds?.[0]?.[1], bounds?.[1]?.[0], bounds?.[1]?.[1]]);

  return null;
}

/** Disegna un cerchio in metri usando Leaflet “puro” */
function RadiusOverlay({
  center,
  radius,
  label,
}: {
  center?: [number, number] | null;
  radius?: number | null;
  label?: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!center || !radius) return;

    const circle = L.circle(center, { radius });
    if (label) circle.bindTooltip(label, { permanent: true });

    circle.addTo(map);
    return () => {
      circle.remove();
    };
  }, [map, center?.[0], center?.[1], radius, label]);

  return null;
}

/** Cattura i click sulla mappa e li propaga */
function ClickCatcher({ onClick }: { onClick?: (latlng: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(e) {
      if (onClick) onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function LocationMap({
  center,
  radius,
  label,
  onClick,
  fallbackBounds,
}: {
  center: { lat: number; lng: number } | null;                // centro “attivo” (se presente)
  radius?: number | null;
  label?: string | null;
  onClick?: (latlng: { lat: number; lng: number }) => void;
  fallbackBounds?: [[number, number], [number, number]];      // bounds da usare quando center è null
}) {
  const mapRef = useRef<LeafletMap | null>(null);

  // tuple per Leaflet oppure nulla
  const ll = useMemo<[number, number] | null>(() => {
    if (!center) return null;
    return [center.lat, center.lng];
  }, [center]);

  // bounds di fallback (Italia) di default, se non passati
  const fb = useMemo<[[number, number], [number, number]]>(() => {
    return (
      fallbackBounds || [
        // Sud-Ovest (Sardegna/Sicilia basse)  , Nord-Est (Alpi/est)
        [35.4897, 6.6267],
        [47.0910, 18.5204],
      ]
    );
  }, [fallbackBounds]);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <MapContainer
        // Inizializziamo "neutro": niente center/zoom qui, gestiamo sotto
        whenReady={(e) => {
          const m = e.target as LeafletMap;
          mapRef.current = m;
          if (ll) {
            m.setView(ll, 12);
          } else {
            m.fitBounds(fb);
          }
          setTimeout(() => m.invalidateSize(), 0);
        }}
        style={{ height: "100%", width: "100%" }}
      >
        <ResizeFix center={ll} bounds={fb} />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ClickCatcher onClick={onClick} />
        <RadiusOverlay center={ll} radius={radius} label={label} />
      </MapContainer>
    </div>
  );
}
