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
    // riallinea la vista dopo il mount/resize
    const realign = () => {
      const currentZoom = map.getZoom() || 12;
      map.setView(center, currentZoom);
      map.invalidateSize();
    };

    // microtask per assicurare che il DOM sia pronto
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

/** Disegna un cerchio in metri usando Leaflet “puro” (evita problemi di typings) */
function RadiusOverlay({
  center,
  radius,
  label,
}: {
  center: [number, number];
  radius?: number;
  label?: string;
}) {
  const map = useMap();

  useEffect(() => {
    if (!radius || radius <= 0) return;

    const circle = L.circle(center, { radius });
    if (label) circle.bindTooltip(label, { permanent: true });

    circle.addTo(map);

    // cleanup quando cambiano props o si smonta
    return () => {
      circle.remove();
    };
  }, [map, center[0], center[1], radius, label]);

  return null;
}

/** Cattura i click sulla mappa e li propaga al prop onClick */
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

  // Converto l’oggetto in tuple per Leaflet, con fallback sicuro
  const ll = useMemo<[number, number]>(() => {
    return center ? [center.lat, center.lng] : [0, 0];
  }, [center?.lat, center?.lng]);

  // Allinea la vista quando cambia il center
  useEffect(() => {
    const map = mapRef.current as unknown as LeafletMap | null;
    if (!map || !center) return;

    const z = map.getZoom() || 12;
    map.setView(ll, z);
    // dopo aver cambiato la view, invalidiamo la dimensione per evitare glitch
    setTimeout(() => map.invalidateSize(), 0);
  }, [center?.lat, center?.lng, ll]);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <MapContainer
        ref={mapRef as any}
        center={ll}               // tuple richiesta da Leaflet
        zoom={12}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <ResizeFix center={ll} />

        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <ClickCatcher onClick={onClick} />

        <RadiusOverlay
          center={ll}
          radius={radius ?? undefined}
          label={label ?? undefined}
        />
      </MapContainer>
    </div>
  );
}
