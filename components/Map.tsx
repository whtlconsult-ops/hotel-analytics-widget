"use client";

import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import L from "leaflet";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

/** Mantiene la mappa “in forma”: ridisegna e riallinea la vista */
function ResizeFix({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    setTimeout(() => {
      const currentZoom = map.getZoom() || 12;
      map.setView(center, currentZoom);
      map.invalidateSize();
    }, 0);

    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [map, center]);

  return null;
}

/** Disegna un cerchio in metri usando Leaflet “puro” (evita i problemi di typings del <Circle/>) */
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
    if (!radius) return;

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
}: {
  center: { lat: number; lng: number } | null;
  radius?: number | null;
  label?: string | null;
  onClick?: (latlng: { lat: number; lng: number }) => void;
}) {
  
  const mapRef = useRef<LeafletMap | null>(null);

  // Config iniziale via API (evitiamo props center/zoom/scrollWheelZoom)
  useEffect(() => {
    const map = mapRef.current as any;
    if (!map) return;

    map.setView(center, 12);
    if (map.scrollWheelZoom && map.scrollWheelZoom.enable) {
      map.scrollWheelZoom.enable();
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [center]);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <MapContainer
        ref={mapRef as any}
        style={{ height: "100%", width: "100%" }}
      >
        <ResizeFix center={center} />

        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ClickCatcher onClick={onClick} />
        <RadiusOverlay center={center} radius={radius} label={label} />

      </MapContainer>
    </div>
  );
}

