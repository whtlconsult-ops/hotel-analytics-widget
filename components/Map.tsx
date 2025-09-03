"use client";

import { MapContainer, TileLayer, Circle, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

function ResizeFix({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    // forza il ridisegno quando il componente appare / cambia misura
    setTimeout(() => {
      map.invalidateSize();
      map.setView(center);
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
        center={center}
        zoom={12}
        scrollWheelZoom
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
