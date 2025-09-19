// app/widget/App.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { it } from "date-fns/locale";
import {
  format, parseISO, startOfMonth, endOfMonth, addDays,
} from "date-fns";
import {
  ResponsiveContainer, LineChart, Line, Area, CartesianGrid, XAxis, YAxis, Tooltip as RTooltip,
  BarChart, Bar
} from "recharts";

/* ================== Map (PAR1: stessa posizione/estetica) ================== */
/* Usiamo react-leaflet via dynamic import (no SSR). Se nel tuo progetto hai già
   un Map.tsx proprietario, puoi ignorare questa sezione e usare quello. */
const LeafletMap = dynamic(async () => {
  const L = await import("react-leaflet");
  return function MapBox(props: {
    center: { lat: number; lng: number };
    radiusKm: number;
    onClick?: (lat: number, lng: number) => void;
  }) {
    const { MapContainer, TileLayer, Circle, Marker, useMapEvents } = L as any;
    const Clicker = () => {
      useMapEvents({
        click(e: any) { props.onClick?.(e.latlng.lat, e.latlng.lng); }
      });
      return null;
    };
    return (
      <MapContainer
        center={[props.center.lat, props.center.lng]}
        zoom={13}
        style={{ width: "100%", height: "100%", borderRadius: 16 }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[props.center.lat, props.center.lng]} />
        <Circle center={[props.center.lat, props.center.lng]} radius={props.radiusKm * 1000} />
        <Clicker />
      </MapContainer>
    );
  };
}, { ssr: false });

/* ================== Tipi risposta backend ================== */
type RelatedBuckets = {
  channels: { label: string; value: number }[];
  provenance: { label: string; value: number }[];
  los: { label: string; value: number }[];
};
type SerpResp = {
  ok: boolean;
  series: { date: string; score: number }[];
  related?: RelatedBuckets;
  note?: string;
};
type QuotaResp = {
  ok: boolean;
  total_searches_left?: number;
  plan_searches_left?: number;
  this_month_usage?: number;
};

/* ================== Costanti PAR1 ================== */
type Mode = "zone" | "competitor";
const RADIUS_OPTIONS = [10, 20, 30] as const;
const TYPE_OPTIONS = ["hotel", "agriturismo", "casa_vacanza", "villaggio_turistico", "resort", "b&b", "affittacamere"] as const;
const TYPE_LABEL: Record<(typeof TYPE_OPTIONS)[number], string> = {
  hotel: "Hotel",
  agriturismo: "Agriturismo",
  casa_vacanza: "Casa Vacanza",
  villaggio_turistico: "Villaggio Turistico",
  resort: "Resort",
  "b&b": "B&B",
  affittacamere: "Affittacamere",
};

/* ================== Helper PAR1 (calendario/serie) ================== */
function daysOfMonthWindow(monthISO: string): Date[] {
  const s = startOfMonth(parseISO(`${monthISO}-01`));
  const e = endOfMonth(parseISO(`${monthISO}-01`));
  const out: Date[] = [];
  let d = s;
  while (d <= e) { out.push(d); d = addDays(d, 1); }
  return out;
}
function resampleToDays(series: { date: string; score: number }[], monthISO: string) {
  const monthDays = daysOfMonthWindow(monthISO);
  if (!series?.length) {
    return monthDays.map(d => ({ dateLabel: format(d, "d MMM", { locale: it }), value: 0 }));
  }
  const m = new Map<string, number>();
  series.forEach(p => m.set(p.date.slice(0, 10), Number(p.score) || 0));
  let last = 0;
  return monthDays.map(d => {
    const iso = format(d, "yyyy-MM-dd");
    if (m.has(iso)) last = m.get(iso)!;
    return { dateLabel: format(d, "d MMM", { locale: it }), value: last };
  });
}
function daysBetween(fromISO: string, toISO: string) {
  const s = parseISO(fromISO), e = parseISO(toISO);
  const out: Date[] = [];
  let d = s;
  while (d <= e) { out.push(d); d = addDays(d, 1); }
  return out;
}
function resampleToRange(series: { date: string; score: number }[], fromISO: string, toISO: string) {
  const days = daysBetween(fromISO, toISO);
  if (!series?.length) {
    return days.map(d => ({ dateLabel: format(d, "d MMM", { locale: it }), value: 0 }));
  }
  const m = new Map<string, number>();
  series.forEach(p => m.set(p.date.slice(0, 10), Number(p.score) || 0));
  let last = 0;
  return days.map(d => {
    const iso = format(d, "yyyy-MM-dd");
    if (m.has(iso)) last = m.get(iso)!;
    return { dateLabel: format(d, "d MMM", { locale: it }), value: last };
  });
}
function movingAverage(arr: number[], k = 3) {
  if (k <= 1) return arr.slice();
  const half = Math.floor(k / 2);
  return arr.map((_, i) => {
    let s = 0, c = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < arr.length) { s += arr[j]; c++; }
    }
    return c ? s / c : arr[i];
  });
}
function normalize0to100(values: number[]): number[] {
  if (!values.length) return [];
  const min = Math.min(...values), max = Math.max(...values);
  const den = Math.max(1, max - min);
  return values.map(v => Math.round(((v - min) / den) * 100));
}
function ensureHotelQ(q: string) {
  return /hotel/i.test(q) ? q.trim() : `${q.trim()} hotel`;
}
function adrFromPressure(p: number, mode: Mode) {
  const baseMin = 80, baseMax = 140;
  const est = baseMin + (p / 100) * (baseMax - baseMin);
  return Math.round(mode === "competitor" ? est * 1.10 : est);
}
export default function AppWidget() {
  /* ======= Stato PAR1 invariato ======= */
  const [dataSource] = useState<"none">("none"); // placeholder PAR1
  const [query, setQuery] = useState("Firenze");
  const [center, setCenter] = useState<{ lat: number; lng: number }>({ lat: 43.7696, lng: 11.2558 });
  const [radius, setRadius] = useState<(typeof RADIUS_OPTIONS)[number]>(20);
  const [monthISO, setMonthISO] = useState(format(new Date(), "yyyy-MM"));
  const [wxProvider, setWxProvider] = useState<"open-meteo" | "openweather">("open-meteo");

  const [types, setTypes] = useState<(typeof TYPE_OPTIONS)[number][]>(["hotel"]);
  const [typesOpen, setTypesOpen] = useState(false);
  const [typesTemp, setTypesTemp] = useState<(typeof TYPE_OPTIONS)[number][]>(["hotel"]);

  const [mode, setMode] = useState<Mode>("zone");

  // Toggle API (PAR1)
  const [askTrend, setAskTrend] = useState(true);
  const [askChannels, setAskChannels] = useState(false);
  const [askProvenance, setAskProvenance] = useState(false);
  const [askLOS, setAskLOS] = useState(false);

  // Avanzate: intervallo personalizzato & smoothing (nuovo, opt-in)
  const [rangeOpen, setRangeOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [smooth3d, setSmooth3d] = useState(false);

  // Dati
  const [serpSeries, setSerpSeries] = useState<SerpResp["series"]>([]);
  const [related, setRelated] = useState<RelatedBuckets | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [quota, setQuota] = useState<QuotaResp | null>(null);
  const [loading, setLoading] = useState(false);

  /* ======= Quota badge ======= */
  async function fetchQuota() {
    try {
      const r = await fetch("/api/serp/quota", { cache: "no-store" });
      const j: QuotaResp = await r.json();
      setQuota(j);
    } catch { /* ignore */ }
  }
  const quotaBadge = useMemo(() => {
    if (!quota?.ok) return "—/—";
    const left = quota.total_searches_left ?? quota.plan_searches_left;
    const used = quota.this_month_usage;
    return (left == null || used == null) ? "—/—" : `${used}/${used + left} (rimasti ${left})`;
  }, [quota]);

  /* ======= URL share (PAR1 compat) ======= */
  function persistUrl() {
    const url = new URL(globalThis?.location?.href || "");
    const p = url.searchParams;
    p.set("q", query); p.set("r", String(radius)); p.set("m", monthISO);
    p.set("mode", mode);
    p.set("trend", askTrend ? "1" : "0");
    p.set("ch", askChannels ? "1" : "0");
    p.set("prov", askProvenance ? "1" : "0");
    p.set("los", askLOS ? "1" : "0");
    p.set("t", types.join(","));
    if (fromDate && toDate) { p.set("from", fromDate); p.set("to", toDate); } else { p.delete("from"); p.delete("to"); }
    try { history.replaceState({}, "", `${url.pathname}?${p.toString()}`); } catch {}
  }

  useEffect(() => { fetchQuota(); /* on mount */ }, []);
  /* ======= SERP fetch ======= */
  async function fetchSerp() {
    setLoading(true);
    try {
      // mese del calendario come fallback
      const mStart = format(startOfMonth(parseISO(`${monthISO}-01`)), "yyyy-MM-dd");
      const mEnd   = format(endOfMonth(parseISO(`${monthISO}-01`)),  "yyyy-MM-dd");
      // se attivo il range, uso quello
      const dFrom = (fromDate && toDate) ? fromDate : mStart;
      const dTo   = (fromDate && toDate) ? toDate   : mEnd;

      const parts: string[] = [];
      if (askTrend) parts.push("trend");
      if (askChannels || askProvenance || askLOS) parts.push("related");

      const u = new URLSearchParams();
      u.set("q", ensureHotelQ(query));
      u.set("lat", String(center.lat));
      u.set("lng", String(center.lng));
      u.set("date", `${dFrom} ${dTo}`);
      u.set("cat", "203");
      u.set("parts", parts.join(",") || "trend");
      if (askChannels)   u.set("ch", "1");
      if (askProvenance) u.set("prov", "1");
      if (askLOS)        u.set("los", "1");

      const r = await fetch(`/api/serp/demand?${u.toString()}`, { cache: "no-store" });
      const j: SerpResp = await r.json();

      if (!j.ok) {
        setSerpSeries([]); setRelated(undefined);
        setNote(j.note || "Nessun dato disponibile per i parametri selezionati.");
      } else {
        setSerpSeries(Array.isArray(j.series) ? j.series : []);
        setRelated(j.related); setNote(j.note);
      }
    } catch {
      setSerpSeries([]); setRelated(undefined); setNote("Errore nel recupero dati.");
    } finally {
      setLoading(false);
      persistUrl();
      fetchQuota();
    }
  }

  /* ======= Derivate: calendario dal mese (ricampionamento giornaliero) ======= */
  const monthDays = useMemo(() => daysOfMonthWindow(monthISO), [monthISO]);
  const trendMonth = useMemo(() => resampleToDays(serpSeries, monthISO), [serpSeries, monthISO]);
  const pressures = useMemo(() => normalize0to100(trendMonth.map(p => p.value || 0)), [trendMonth]);
  const calendarData = useMemo(() => monthDays.map((d, i) => ({
    dateISO: format(d, "yyyy-MM-dd"),
    day: format(d, "d", { locale: it }),
    pressure: pressures[i] || 0,
    adr: adrFromPressure(pressures[i] || 0, mode),
  })), [monthDays, pressures, mode]);

  /* ======= Derivate: grafico in basso (range o mese) + smoothing opzionale ======= */
  const trendRangeBase = useMemo(() => {
    if (fromDate && toDate) return resampleToRange(serpSeries, fromDate, toDate);
    return resampleToDays(serpSeries, monthISO);
  }, [serpSeries, fromDate, toDate, monthISO]);

  const trendRange = useMemo(() => {
    if (!smooth3d) return trendRangeBase;
    const sm = movingAverage(trendRangeBase.map(x => x.value), 3);
    return trendRangeBase.map((p, i) => ({ ...p, value: sm[i] }));
  }, [trendRangeBase, smooth3d]);

  const disabledGenerate = loading || !query.trim();
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar PAR1 */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="text-sm font-semibold">Widget Analisi Domanda – Hospitality</div>
          <div className="text-xs px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
            SERP {quotaBadge}
          </div>
          <div className="flex-1" />
          {note && <div className="text-[12px] text-slate-500">{note}</div>}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Colonna sinistra (PAR1) */}
        <aside className="lg:col-span-4 space-y-3">
          {/* Località, raggio, mese, meteo */}
          <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <div className="text-sm font-semibold">Località</div>
            <div className="flex gap-2">
              <input
                className="flex-1 h-10 px-3 rounded-xl border"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Es. Firenze"
              />
              <button
                className="px-3 h-10 rounded-xl border bg-white"
                onClick={() => fetch(`/api/external/geocode?q=${encodeURIComponent(query)}`).then(r=>r.json()).then(j=>{
                  const lat = Number(j?.lat), lng = Number(j?.lon);
                  if (Number.isFinite(lat) && Number.isFinite(lng)) setCenter({lat,lng});
                }).catch(()=>{})}
              >Cerca</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-600 mb-1">Raggio</div>
                <select
                  className="h-9 px-2 rounded-xl border w-full"
                  value={radius}
                  onChange={e => setRadius(Number(e.target.value) as any)}
                >
                  {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} km</option>)}
                </select>
              </div>
              <div>
                <div className="text-xs text-slate-600 mb-1">Mese</div>
                <input
                  type="month"
                  className="h-9 px-2 rounded-xl border w-full"
                  value={monthISO}
                  onChange={e => setMonthISO(e.currentTarget.value)}
                />
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-600 mb-1">Meteo</div>
              <select
                className="h-9 px-2 rounded-xl border w-full"
                value={wxProvider}
                onChange={e => setWxProvider(e.target.value as any)}
              >
                <option value="open-meteo">Open-Meteo (default)</option>
                <option value="openweather">OpenWeather (se configurato)</option>
              </select>
            </div>

            {/* Tipologie (multi-select persistente) */}
            <div>
              <div className="text-xs text-slate-600 mb-1">Tipologie</div>
              <button
                className="h-9 px-3 rounded-xl border bg-slate-50 w-full text-left"
                onClick={() => setTypesOpen(v => !v)}
              >
                {types.map(t => TYPE_LABEL[t]).join(", ") || "Seleziona…"}
              </button>
              {typesOpen && (
                <div className="mt-2 p-3 border rounded-xl space-y-2">
                  {TYPE_OPTIONS.map(t => (
                    <label key={t} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={typesTemp.includes(t)}
                        onChange={e=>{
                          if (e.currentTarget.checked) setTypesTemp([...typesTemp, t]);
                          else setTypesTemp(typesTemp.filter(x => x !== t));
                        }}
                      />
                      {TYPE_LABEL[t]}
                    </label>
                  ))}
                  <div className="flex gap-2 pt-2">
                    <button className="h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs"
                      onClick={()=>{ setTypes(typesTemp); setTypesOpen(false); }}
                    >Applica</button>
                    <button className="h-8 px-3 rounded-lg bg-slate-200 text-xs"
                      onClick={()=>{ setTypesTemp(types); setTypesOpen(false); }}
                    >Annulla</button>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-1">Default: Hotel.</p>
            </div>

            {/* Dati da chiedere alle API */}
            <div className="pt-1">
              <div className="text-sm font-semibold mb-1">Dati da chiedere alle API</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={askTrend} onChange={e=>setAskTrend(e.currentTarget.checked)} />
                Andamento domanda (Google Trends)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={askChannels} onChange={e=>setAskChannels(e.currentTarget.checked)} />
                Canali di vendita
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={askProvenance} onChange={e=>setAskProvenance(e.currentTarget.checked)} />
                Provenienza clienti
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={askLOS} onChange={e=>setAskLOS(e.currentTarget.checked)} />
                Durata media soggiorno (LOS)
              </label>
              <p className="text-[11px] text-slate-500 mt-1">
                Spunta solo i grafici che ti servono: risparmi query su SerpAPI.
              </p>
            </div>

            {/* Modalità */}
            <div className="pt-1">
              <div className="text-sm font-semibold mb-1">Modalità</div>
              <div className="flex gap-2">
                <button
                  className={`h-9 px-3 rounded-xl text-sm border ${mode==='zone'?'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}
                  onClick={() => setMode('zone')}
                >Zona</button>
                <button
                  className={`h-9 px-3 rounded-xl text-sm border ${mode==='competitor'?'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}
                  onClick={() => setMode('competitor')}
                >Competitor</button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Zona = baseline dell’area. Competitor = stessa curva ma ADR più “aggressivo”.
              </p>
            </div>

            {/* Avanzate: periodo personalizzato (solo grafico) */}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setRangeOpen(v => !v)}
                className="text-xs text-slate-600 underline underline-offset-2"
              >
                Avanzate: periodo personalizzato (solo grafico)
              </button>
              {rangeOpen && (
                <div className="mt-2 grid gap-2 rounded-lg border p-2 bg-slate-50/60">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-slate-600">Da</label>
                    <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} className="h-8 px-2 rounded-md border text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-slate-600">A</label>
                    <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} className="h-8 px-2 rounded-md border text-sm" />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      className="px-2 h-7 rounded-md border text-[11px]"
                      onClick={() => {
                        const today = new Date(); const to = format(today,'yyyy-MM-dd');
                        const from = format(addDays(today, -30),'yyyy-MM-dd');
                        setFromDate(from); setToDate(to);
                      }}
                    >Ultimi 30gg</button>
                    <button
                      type="button"
                      className="px-2 h-7 rounded-md border text-[11px]"
                      onClick={() => {
                        const today = new Date(); const to = format(today,'yyyy-MM-dd');
                        const from = format(addDays(today, -90),'yyyy-MM-dd');
                        setFromDate(from); setToDate(to);
                      }}
                    >90gg</button>
                    <button
                      type="button"
                      className="px-2 h-7 rounded-md border text-[11px]"
                      onClick={() => {
                        const today = new Date(); const to = format(today,'yyyy-MM-dd');
                        const from = format(addDays(today, -365),'yyyy-MM-dd');
                        setFromDate(from); setToDate(to);
                      }}
                    >365gg</button>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-[12px]">
                    <input type="checkbox" checked={smooth3d} onChange={e=>setSmooth3d(e.currentTarget.checked)} />
                    Media mobile 3 giorni (grafico)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Il calendario resta mensile; il range qui influenza solo “Andamento Domanda”.
                  </p>
                </div>
              )}
            </div>

            {/* CTA */}
            <div className="pt-2 flex gap-2">
              <button
                onClick={fetchSerp}
                disabled={disabledGenerate}
                className={`flex-1 h-10 rounded-2xl text-white text-sm font-semibold ${disabledGenerate?'bg-slate-300':'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                {loading ? 'Elaboro…' : 'Genera Analisi'}
              </button>
              <button
                className="h-10 px-3 rounded-2xl text-sm border bg-white"
                onClick={()=>{
                  setQuery("Firenze"); setCenter({lat:43.7696, lng:11.2558}); setRadius(20);
                  setMonthISO(format(new Date(),"yyyy-MM")); setWxProvider("open-meteo");
                  setTypes(["hotel"]); setTypesOpen(false); setTypesTemp(["hotel"]);
                  setMode("zone"); setAskTrend(true); setAskChannels(false); setAskProvenance(false); setAskLOS(false);
                  setFromDate(""); setToDate(""); setSmooth3d(false);
                  setSerpSeries([]); setRelated(undefined); setNote(undefined);
                  persistUrl();
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </aside>

        {/* Colonna destra (mappa + calendario + grafici) */}
        <section className="lg:col-span-8 space-y-6">
          {/* Mappa PAR1 */}
          <div className="bg-white rounded-2xl border shadow-sm p-3">
            <div className="h-[360px]">
              <LeafletMap
                center={center}
                radiusKm={radius}
                onClick={(lat, lng) => setCenter({ lat, lng })}
              />
            </div>
          </div>

          {/* Calendario PAR1: tessere con pressione + ADR */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">
              Calendario Domanda + ADR — {format(parseISO(`${monthISO}-01`), "MMMM yyyy", { locale: it })}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {calendarData.map((d) => {
                const hue = 12; // arancio/rosso PAR1
                const light = 92 - Math.round((d.pressure || 0) * 0.5);
                const bg = `hsl(${hue},90%,${light}%)`;
                return (
                  <div key={d.dateISO} className="rounded-xl p-2 border text-center" style={{ background: bg }}>
                    <div className="text-xs font-semibold">{d.day}</div>
                    <div className="text-[11px] mt-1">€{d.adr}</div>
                  </div>
                );
              })}
            </div>
            <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-2">
              <span>Bassa domanda</span>
              <div className="h-1 flex-1 rounded-full" style={{
                background: "linear-gradient(to right, hsl(12,90%,92%), hsl(12,90%,55%))"
              }} />
              <span>Alta domanda</span>
            </div>
          </div>

          {/* Segmenti (visibili solo se selezionati) */}
          {(askProvenance || askLOS || askChannels) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border shadow-sm p-4">
                <div className="text-sm font-semibold mb-2">Provenienza Clienti</div>
                {!related?.provenance?.length ? (
                  <div className="h-48 grid place-items-center text-sm text-slate-500">Nessun segnale utile per questo periodo/area.</div>
                ) : (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={related.provenance}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" />
                        <YAxis allowDecimals={false} />
                        <RTooltip />
                        <Bar dataKey="value" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl border shadow-sm p-4">
                <div className="text-sm font-semibold mb-2">Durata Media Soggiorno (LOS)</div>
                {!related?.los?.length ? (
                  <div className="h-48 grid place-items-center text-sm text-slate-500">Nessun segnale utile per questo periodo/area.</div>
                ) : (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={related.los}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" />
                        <YAxis allowDecimals={false} />
                        <RTooltip />
                        <Bar dataKey="value" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="md:col-span-2 bg-white rounded-2xl border shadow-sm p-4">
                <div className="text-sm font-semibold mb-2">Canali di Vendita</div>
                {!related?.channels?.length ? (
                  <div className="h-56 grid place-items-center text-sm text-slate-500">Nessun segnale utile per questo periodo/area.</div>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={related.channels}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" />
                        <YAxis allowDecimals={false} />
                        <RTooltip />
                        <Bar dataKey="value" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Grafico in basso: mese o range (con smoothing opzionale) */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">
              {fromDate && toDate
                ? <>Andamento Domanda — {fromDate} → {toDate}</>
                : <>Andamento Domanda — {format(parseISO(`${monthISO}-01`),'MMMM yyyy',{locale:it})}</>
              }
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendRange}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dateLabel" interval={Math.ceil(Math.max(12, trendRange.length / 12))} />
                  <YAxis />
                  <RTooltip />
                  <defs>
                    <linearGradient id="gradLine" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1e3a8a" />
                      <stop offset="100%" stopColor="#1e3a8a" />
                    </linearGradient>
                    <linearGradient id="fillLine" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1e3a8a" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#1e3a8a" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="value" fill="url(#fillLine)" stroke="url(#gradLine)" />
                  <Line type="monotone" dataKey="value" stroke="#1e3a8a" strokeWidth={1.6} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
