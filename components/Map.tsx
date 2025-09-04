"use client";

import { MapContainer, TileLayer, Circle, Tooltip, useMap } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

function ResizeFix({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    // Ridisegna e riallinea la vista dopo il mount
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
        // ❗ Non passiamo più center/zoom/scrollWheelZoom come props
        //   per evitare incompatibilità di typings durante la build
        style={{ height: "100%", width: "100%" }}
        whenCreated={(map: LeafletMap) => {
          // Vista iniziale e interazioni configurate via codice
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

