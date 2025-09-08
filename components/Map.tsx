// components/Map.tsx
"use client";

import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import "leaflet/dist/leaflet.css";

/** Mantiene la mappa “in forma”: ridisegna e riallinea la vista */
function ResizeFix({ center }: { center: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    const realign = () => {
      const z = map.getZoom() || 12;
      map.setView(center, z);
      map.invalidateSize();
    };

    const id = setTimeout(realign, 0);
    const onResize = () => map.invalidateSize();

    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(id);
      window.removeEventListener("resize", onResize);
    };
  }, [map, center[0], center[1]]);

  return null;
}

/** Disegna un cerchio in metri con Leaflet “puro” */
function RadiusOverlay({
  center,
  radius,
  label,
}: {
  center: [number, number];
  radius?: number | null;
  label?: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!radius || radius <= 0) return;

    const circle = L.circle(center, { radius });
    if (label) circle.bindTooltip(label, { permanent: true });

    circle.addTo(map);
    return () => {
      circle.remove();
    };
  }, [map, center[0], center[1], radius, label]);

  return null;
}

/** Cattura i click sulla mappa e li propaga */
function ClickCatcher({
  onClick,
}: {
  onClick?: (latlng: { lat: number; lng: number }) => void;
}) {
  useMapEvents({
    click(e) {
      onClick?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function LocationMap({
  center,
  radius,
  label,
  onClick,
}: {
  center: { lat: number; lng: number } | null;
  radius?: number | null;
  label?: string | null;
  onClick?: (latlng: { lat: number; lng: number }) => void;
}) {
  const mapRef = useRef<LeafletMap | null>(null);

  // Converto in tuple [lat,lng] per Leaflet; fallback sicuro
  const ll = useMemo<[number, number]>(() => {
    return center ? [center.lat, center.lng] : [0, 0];
  }, [center?.lat, center?.lng]);

  // Aggiorna vista quando cambia il center
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) return;

    const z = map.getZoom() || 12;
    map.setView(ll, z);
    setTimeout(() => map.invalidateSize(), 0);
  }, [center?.lat, center?.lng, ll]);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <MapContainer
        // Niente center/zoom/scrollWheelZoom qui: inizializziamo con whenCreated
        whenCreated={(m: LeafletMap) => {
          mapRef.current = m;
          m.setView(ll, 12);
          try {
            // abilita zoom da rotella se disponibile
            // @ts-ignore - alcune versioni non tipizzano correttamente il controllo
            m.scrollWheelZoom?.enable?.();
          } catch {/* ignore */}
          setTimeout(() => m.invalidateSize(), 0);
        }}
        style={{ height: "100%", width: "100%" }}
      >
        <ResizeFix center={ll} />

        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <ClickCatcher onClick={onClick} />

        <RadiusOverlay center={ll} radius={radius ?? undefined} label={label ?? undefined} />
      </MapContainer>
    </div>
  );
}
