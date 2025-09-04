"use client";

import { MapContainer, TileLayer, Circle, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

function ResizeFix({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    // Riallinea la vista e forza il ridisegno dopo il mount
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
  return (
    <div style={{ height: "100%", width: "100%" }}>
      <MapContainer
        // ❗ Niente center/zoom/scrollWheel nel JSX per evitare problemi di typings
        style={{ height: "100%", width: "100%" }}
        whenReady={(event) => {
          const map = event.target; // Leaflet Map
          map.setView(center, 12);
          map.scrollWheelZoom.enable();
          setTimeout(() => map.invalidateSize(), 0);
        }}
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

