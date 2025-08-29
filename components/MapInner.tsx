"use client";
import { MapContainer, TileLayer, Circle, Marker, Popup } from "react-leaflet";

export default function MapInner({
  center, radius, label,
}:{ center:[number,number]; radius:number; label:string }){
  return (
    <MapContainer center={center} zoom={11} style={{ height: 280, width: "100%", borderRadius: 12 }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
      <Marker position={center}><Popup>{label}</Popup></Marker>
      <Circle center={center} radius={radius} pathOptions={{ color: "#0ea5e9", fillOpacity: 0.08 }} />
    </MapContainer>
  );
}
