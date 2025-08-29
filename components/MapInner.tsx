"use client";

import {
  MapContainer as RLMapContainer,
  TileLayer,
  Circle,
  Marker,
  Popup,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";

export default function MapInner({
  center,
  radius,
  label,
}: {
  center: [number, number];
  radius: number;
  label: string;
}) {
  // Forziamo il tipo atteso da Leaflet
  const position: LatLngExpression = center;

  return (
    <RLMapContainer
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
    </RLMapContainer>
  );
}

