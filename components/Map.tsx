"use client";

import { MapContainer, TileLayer, Circle, Tooltip, useMap } from "react-leaflet";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

/**
 * Mantiene la mappa in forma: forza il ridisegno e riallinea la vista
 * quando il componente viene montato o cambia il center.
 */
function ResizeFix({ center }: { center: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    // Riallinea la vista e ridisegna subito dopo il mount/update
    setTimeout(() => {
      const currentZoom = map.getZoom() || 12;
      map.setView(center, currentZoom);
      map.invalidateSize();
    }, 0);

    // Ridisegna anche su resize finestra
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
  // Usiamo "any" per evitare incompatibilità di typings tra versioni leaflet/react-leaflet
  const mapRef = useRef<any>(null);

  // Configurazione iniziale via API (evitiamo props tipo center/zoom/scrollWheelZoom)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Vista iniziale e abilitazione zoom a rotella
    map.setView(center, 12);
    if (map.scrollWheelZoom && map.scrollWheelZoom.enable) {
      map.scrollWheelZoom.enable();
    }

    // Evita “mappa a riquadri” quando cambia layout
    setTimeout(() => map.invalidateSize(), 0);
  }, [center]);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <MapContainer
        // ❗ Nessuna prop "center/zoom/scrollWheelZoom/whenReady/whenCreated" per evitare errori di typing
        ref={mapRef}
        style={{ height: "100%", width: "100%" }}
      >
        <ResizeFix center={center} />

        {/* Layer OSM: manteniamo solo l’URL per massima compatibilità typings */}
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

