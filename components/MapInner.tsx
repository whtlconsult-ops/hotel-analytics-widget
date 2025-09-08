"use client";

import React from "react";
import {
  MapContainer as RLMapContainer,
  TileLayer,
  Circle,
  Marker,
  Popup,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";

// Cast per evitare problemi di tipi in CI/TS
const MapContainerAny = RLMapContainer as unknown as React.ComponentType<any>;
const CircleAny = Circle as unknown as React.ComponentType<any>;

export default function MapInner({
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
  const position: LatLngExpression = center;

  return (
    <div style={{ position: "relative" }}>
      <MapContainerAny
        center={position}
        zoom={11}
        style={{ height: 280, width: "100%", borderRadius: 12 }}
      >
        <TileLayer
          // niente 'attribution' qui per evitare errori di tipi
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={position}>
          <Popup>{label}</Popup>
        </Marker>
        <CircleAny
          center={position}
          radius={radius}
          pathOptions={{ color: "#0ea5e9", fillOpacity: 0.08 }}
        />
      </MapContainerAny>

      {/* Overlay attribuzione OSM */}
      <div
        style={{
          position: "absolute",
          right: 8,
          bottom: 6,
          fontSize: 11,
          background: "rgba(255,255,255,0.9)",
          padding: "2px 6px",
          borderRadius: 6,
        }}
      >
        © OpenStreetMap contributors
      </div>
    </div>
  );
}

