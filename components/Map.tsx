"use client";

import { MapContainer, TileLayer, Circle, Tooltip, useMap } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

function ResizeFix({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
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
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.setView(center, 12);
    map.scrollWheelZoom.enable();

    setTimeout(() => map.invalidateSize(), 0);
  }, [center]);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <MapContainer
        ref={mapRef}
        style={{ height: "100%", width: "100%" }}
        attributionControl={true} // ✅ gestisce attribuzione OSM
      >
        <ResizeFix center={center} />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {radius ? (
          <Circle center={center} radius={radius}>
            {label ? <Tooltip permanent>{label}</Tooltip> : null}
          </Circle>
        ) : null}
      </MapContainer>
    </div>
  );
}

