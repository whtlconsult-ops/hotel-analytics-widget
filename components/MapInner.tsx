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

// Cast a prova di build su Vercel/TS
const MapContainerAny = RLMapContainer as unknown as React.ComponentType<any>;

export default function MapInner({
  center,
  radius,
  label,
}: {
  center: [number, number];
  radius: number;
  label: string;
}) {
  const position: LatLngExpression = center;

  return (
    <MapContainerAny
      center={position}
      zoom={11}
      style={{ height: 280, width: "100%", borderRadius: 12 }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap"
      />
      <Marker position={position}>
        <Popup>{label}</Popup>
      </Marker>
      <Circle
        center={position}
        radius={radius}
        pathOptions={{ color: "#0ea5e9", fillOpacity: 0.08 }}
      />
    </MapContainerAny>
  );
}

