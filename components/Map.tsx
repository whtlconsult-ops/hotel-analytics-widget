"use client";

import { MapContainer, TileLayer, Circle, Tooltip, useMap } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

function ResizeFix({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    // Riallinea e forza il ridisegno dopo il mount / resize
    setTimeout(() => {
      map.setView(center, map.getZoom() || 12);
      map.invalidateSize();
    }, 0);

    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [map, center]);

  return null;
}

export default function LocationMap({
  center,
  radius,
  label,
}: {
  center: [number, number];
  radius?: number;
  label?: string;
}) {
  // Ref alla mappa Leaflet (React forwardRef è supportato da MapContainer)
  const mapRef = useRef<LeafletMap | null>(null);

  // Applica configurazioni iniziali quando la mappa è disponibile
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Imposta vista e abilita scroll wheel via API (evitiamo props che danno noie ai tipi)
    map.setView(center, 12);
    map.scrollWheelZoom.enable();

    // Evita "mappa a riquadri" quando cambia il layout
    setTimeout(() => map.invalidateSize(), 0);
  }, [center]);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <MapContainer
        // ❗ Non passiamo center/zoom/scrollWheelZoom nel JSX: li settiamo via ref
        ref={mapRef}
        style={{ height: "100%", width: "100%" }}
      >
        <ResizeFix center={center} />
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {radius ? (
          <Circle center={center} radius={radius}>
            {label ? <Tooltip permanent>{label}</Tooltip> : null}
          </Circle>
        ) : null}
      </MapContainer>
    </div>
  );
}

