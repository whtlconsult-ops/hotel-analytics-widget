'use client';

type Props = {
  lat: number;
  lng: number;
  radiusKm: number;
  onPick?: (p: { lat: number; lng: number; label?: string }) => void;
};

export default function Map({ lat, lng, radiusKm, onPick }: Props) {
  return (
    <div
      className="h-60 rounded-xl border grid place-items-center text-xs text-slate-600"
      title="Placeholder mappa. Clic per confermare il punto corrente."
      onClick={() => onPick?.({ lat, lng, label: undefined })}
    >
      <div>🗺️ Mappa (placeholder)</div>
      <div>Lat: {lat.toFixed(4)} — Lng: {lng.toFixed(4)} — Raggio: {radiusKm} km</div>
      <div className="text-[11px] text-slate-400">Sostituiscimi con Leaflet quando vuoi</div>
    </div>
  );
}
