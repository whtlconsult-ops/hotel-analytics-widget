// ===== Block 1/4 =====
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ResponsiveContainer,
  AreaChart, Area, CartesianGrid, XAxis, YAxis,
  Tooltip as RTooltip, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, Legend
} from "recharts";
import LocationMap from "./Map";

import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth
} from "date-fns";
import { it } from "date-fns/locale";

// ==== Tipi base ====
type Mode = "zone" | "competitor";

type SerpDemandPayload = {
  ok: boolean;
  series?: { date: string; score: number }[];
  related?: {
    channels: Array<{ label: string; value: number }>;
    provenance: Array<{ label: string; value: number }>;
    los: Array<{ label: string; value: number }>;
  };
  usage?: any;
  note?: string;
  error?: string;
};

type Normalized = {
  warnings: string[];
  safeMonthISO: string;
  safeDays: Date[];
  center: { lat: number; lng: number } | null;
  safeR: number;
  safeT: string[];
  isBlocked: boolean;
};

const STRUCTURE_TYPES = ["hotel", "b&b", "casa vacanza", "agriturismo"] as const;

// ==== Util ====
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clampRadiusSilently = (km: number) => clamp(km || 10, 5, 30);

const parseListParam = (v: string | null) =>
  (v ? v.split(",").map(s => s.trim()).filter(Boolean) : []);

const parseNumParam = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function safeParseMonthISO(m: string, warnings: string[]) {
  try {
    const d = parseISO(`${m.slice(0, 7)}-01`);
    if (isNaN(d.getTime())) throw new Error();
    return format(d, "yyyy-MM-01");
  } catch {
    warnings.push("Mese non valido → ripristinato al mese corrente.");
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
}

function daysOfMonthWindow(monthISO: string) {
  const d0 = parseISO(monthISO);
  const start = startOfMonth(d0);
  const end = endOfMonth(d0);
  return eachDayOfInterval({ start, end });
}

// serie settimanale → giornaliera sulla finestra del mese
function resampleToDays(series: { date: string; score: number }[], monthISO: string) {
  const days = daysOfMonthWindow(monthISO);
  const map = new Map<string, number>();
  (series || []).forEach(p => map.set(p.date.slice(0, 10), Number(p.score) || 0));
  let last = 0;
  return days.map(d => {
    const iso = format(d, "yyyy-MM-dd");
    const v = map.get(iso);
    if (v != null) last = v;
    return { dateLabel: format(d, "d MMM", { locale: it }), value: last };
  });
}

// ADR “stimato” dalla pressione (stessa logica PAR1)
function adrFromPressure(p: number, mode: Mode) {
  const baseMin = 80, baseMax = 140;
  const est = baseMin + (clamp(p, 0, 100) / 100) * (baseMax - baseMin);
  const v = mode === "competitor" ? est * 1.10 : est;
  return Math.round(v);
}

function replaceUrl(router: ReturnType<typeof useRouter>, pathname: string, params: URLSearchParams) {
  const url = `${pathname}?${params.toString()}`;
  try { router.replace(url, { scroll: false }); } catch {}
  try { if (typeof window !== "undefined") window.history.replaceState({}, "", url); } catch {}
}

// ===== Block 2/4 =====
export default function App() {
  const router = useRouter();
  const search = useSearchParams();

  // Avvisi
  const [notices, setNotices] = useState<string[]>([]);

  // Filtri base (PAR1)
  const [mode, setMode] = useState<Mode>("zone");
  const [query, setQuery] = useState("Firenze");
  const [radius, setRadius] = useState<number>(20);
  const [monthISO, setMonthISO] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [types, setTypes] = useState<string[]>(["hotel"]);

  // Meteo provider
  const [wxProvider, setWxProvider] = useState<"open-meteo" | "openweather">("open-meteo");

  // Toggles SERP
  const [askTrend, setAskTrend] = useState(true);
  const [askChannels, setAskChannels] = useState(false);
  const [askProvenance, setAskProvenance] = useState(false);
  const [askLOS, setAskLOS] = useState(false);

  // Stato applicato
  const [aQuery, setAQuery] = useState(query);
  const [aRadius, setARadius] = useState(radius);
  const [aMonthISO, setAMonthISO] = useState(monthISO);
  const [aTypes, setATypes] = useState<string[]>(types);
  const [aMode, setAMode] = useState<Mode>(mode);
  const [aCenter, setACenter] = useState<{ lat: number; lng: number } | null>({ lat: 43.7696, lng: 11.2558 });

  // Dati grafici
  const [serpTrend, setSerpTrend] = useState<Array<{ dateLabel: string; value: number }>>([]);
  const [serpChannels, setSerpChannels] = useState<Array<{ channel: string; value: number }>>([]);
  const [serpOrigins, setSerpOrigins] = useState<Array<{ name: string; value: number }>>([]);
  const [serpLOS, setSerpLOS] = useState<Array<{ bucket: string; value: number }>>([]);
  const [serpUsage, setSerpUsage] = useState<{ used?: number; total?: number; left?: number } | null>(null);

  const [weatherByDate, setWeatherByDate] = useState<Record<string, { t?: number; p?: number; code?: number }>>({});
  const [holidays, setHolidays] = useState<Record<string, string>>({});

  // Normalizzazione
  const normalized: Normalized = useMemo(() => {
    const warnings: string[] = [];
    const center = aCenter;
    const safeR = clampRadiusSilently(aRadius);
    const safeT = aTypes.length ? aTypes.filter(t => (STRUCTURE_TYPES as readonly string[]).includes(t)) : ["hotel"];
    const safeMonthISO = safeParseMonthISO(aMonthISO, warnings);
    const safeDays = daysOfMonthWindow(safeMonthISO);
    return { warnings, safeMonthISO, safeDays, center: center ?? null, safeR, safeT, isBlocked: !center };
  }, [aCenter, aRadius, aTypes, aMonthISO]);

  useEffect(() => {
    setNotices(prev => (prev.join("|") === normalized.warnings.join("|") ? prev : normalized.warnings));
  }, [normalized.warnings]);

  // Carica stato da URL una volta
  useEffect(() => {
    if (!search) return;
    const q = search.get("q") ?? "Firenze";
    const r = parseNumParam(search.get("r"), radius);
    const m = search.get("m") ? `${search.get("m")}-01` : monthISO;
    const rawT = parseListParam(search.get("t"));
    const validT = rawT.filter(x => (STRUCTURE_TYPES as readonly string[]).includes(x));
    const t = validT.length ? validT : ["hotel"];
    const modeParam: Mode = (search.get("mode") === "competitor" ? "competitor" : "zone");

    const trendQ = search.get("trend"); const chQ = search.get("ch"); const prQ = search.get("prov"); const losQ = search.get("los");
    const wx = (search.get("wx") as "open-meteo" | "openweather") || "open-meteo";

    setQuery(q); setRadius(r); setMonthISO(m); setTypes(t); setMode(modeParam);
    setAskTrend(trendQ == null ? true : trendQ === "1");
    setAskChannels(chQ === "1"); setAskProvenance(prQ === "1"); setAskLOS(losQ === "1");
    setWxProvider(wx);

    setAQuery(q); setARadius(r); setAMonthISO(m); setATypes(t); setAMode(modeParam);
    setACenter({ lat: 43.7696, lng: 11.2558 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Festività IT
  useEffect(() => {
    const y = Number(aMonthISO.slice(0, 4));
    if (!y) return;
    fetch(`/api/external/holidays?year=${y}&country=IT`)
      .then(r => r.json())
      .then(j => {
        if (!j?.ok) return;
        const map: Record<string, string> = {};
        (j.holidays || []).forEach((h: any) => { map[h.date] = h.localName || h.name; });
        setHolidays(map);
      }).catch(() => {});
  }, [aMonthISO]);

  // Meteo (giornaliero del mese)
  useEffect(() => {
    if (!normalized.center || !aMonthISO) { setWeatherByDate({}); return; }
    const { lat, lng } = normalized.center;
    const url = `/api/external/weather?lat=${lat}&lng=${lng}&monthISO=${encodeURIComponent(aMonthISO)}&provider=${wxProvider}`;
    fetch(url)
      .then(r => r.json())
      .then(j => {
        if (!j?.ok || !j.weather?.daily) { setWeatherByDate({}); return; }
        const daily = j.weather.daily;
        const out: Record<string, { t?: number; p?: number; code?: number }> = {};
        (daily.time || []).forEach((d: string, i: number) => {
          out[d] = {
            t: Array.isArray(daily.temperature_2m_mean) ? daily.temperature_2m_mean[i] : undefined,
            p: Array.isArray(daily.precipitation_sum) ? daily.precipitation_sum[i] : undefined,
            code: Array.isArray(daily.weathercode) ? daily.weathercode[i] : undefined,
          };
        });
        setWeatherByDate(out);
      }).catch(() => setWeatherByDate({}));
  }, [normalized.center, aMonthISO, wxProvider]);

// ===== Block 3/4 =====
  // Cerca località (geocoding)
  const handleSearchLocation = useCallback(async () => {
    const q = (query || "").trim();
    if (!q) return;
    try {
      const res = await fetch(`/api/external/geocode?q=${encodeURIComponent(q)}`);
      const j = await res.json();
      const item = Array.isArray(j?.results) ? j.results[0] : j?.result || j;
      const lat = Number(item?.lat ?? item?.latitude);
      const lng = Number(item?.lng ?? item?.longitude);
      const name = String(item?.name ?? item?.display_name ?? q);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setACenter({ lat, lng }); setAQuery(name);
        setARadius(radius); setAMonthISO(monthISO); setATypes(types); setAMode(mode);
        const p = new URLSearchParams();
        p.set("q", name); p.set("r", String(radius)); p.set("m", monthISO.slice(0, 7));
        p.set("t", types.join(",")); p.set("mode", mode);
        p.set("trend", askTrend ? "1" : "0"); p.set("ch", askChannels ? "1" : "0");
        p.set("prov", askProvenance ? "1" : "0"); p.set("los", askLOS ? "1" : "0");
        p.set("wx", wxProvider);
        replaceUrl(router, (typeof window !== "undefined" ? location.pathname : "/"), p);
      } else { alert("Località non trovata"); }
    } catch { alert("Errore di geocoding"); }
  }, [query, radius, monthISO, types, mode, askTrend, askChannels, askProvenance, askLOS, wxProvider, router]);

  // Click mappa (reverse geocoding)
  const onMapClick = useCallback(async ({ lat, lng }: { lat: number; lng: number }) => {
    let name = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try {
      const r = await fetch(`/api/external/reverse-geocode?lat=${lat}&lng=${lng}`);
      const j = r.ok ? await r.json() : null;
      if (j) name = String(j?.name ?? j?.display_name ?? name);
    } catch {}
    setQuery(name);
    setACenter({ lat, lng }); setAQuery(name);
    setARadius(radius); setAMonthISO(monthISO); setATypes(types); setAMode(mode);
    const p = new URLSearchParams();
    p.set("q", name); p.set("r", String(radius)); p.set("m", monthISO.slice(0, 7));
    p.set("t", types.join(",")); p.set("mode", mode);
    p.set("trend", askTrend ? "1" : "0"); p.set("ch", askChannels ? "1" : "0");
    p.set("prov", askProvenance ? "1" : "0"); p.set("los", askLOS ? "1" : "0");
    p.set("wx", wxProvider);
    replaceUrl(router, (typeof window !== "undefined" ? location.pathname : "/"), p);
  }, [radius, monthISO, types, mode, askTrend, askChannels, askProvenance, askLOS, wxProvider, router]);

  // SERP: linea + related + quota
  const fetchSerp = useCallback(async () => {
    if (!aCenter) return;

    const needTrend = askTrend;
    const needRelated = askChannels || askProvenance || askLOS;
    if (!needTrend && !needRelated) return;

    try {
      const params = new URLSearchParams();
      params.set("q", `${aQuery} hotel`);
      params.set("lat", String(aCenter.lat));
      params.set("lng", String(aCenter.lng));
      params.set("cat", "203");
      params.set("parts", [
        needTrend ? "trend" : "",
        needRelated ? "related" : "",
      ].filter(Boolean).join(","));
      // intervallo totale (12 mesi) per robustezza; render poi filtra sul mese selezionato
      params.set("date", "today 12-m");
      if (askChannels) params.set("ch", "1");
      if (askProvenance) params.set("prov", "1");
      if (askLOS) params.set("los", "1");

      const r = await fetch(`/api/serp/demand?${params.toString()}`);
      const j: SerpDemandPayload = await r.json();
      if (!j?.ok) {
        setNotices(prev => Array.from(new Set([...prev, j?.error || "Errore SERP."])));
        return;
      }

      if (needTrend && Array.isArray(j.series)) {
        setSerpTrend(resampleToDays(j.series, aMonthISO));
      } else {
        setSerpTrend([]);
      }

      if (needRelated && j.related) {
        const rel = j.related;
        setSerpChannels(askChannels ? [
          { channel: "Booking", value: rel.channels.find(x => x.label === "booking")?.value || 0 },
          { channel: "Airbnb", value: rel.channels.find(x => x.label === "airbnb")?.value || 0 },
          { channel: "Diretto", value: rel.channels.find(x => x.label === "diretto")?.value || 0 },
          { channel: "Expedia", value: rel.channels.find(x => x.label === "expedia")?.value || 0 },
          { channel: "Altro", value: rel.channels.find(x => x.label === "altro")?.value || 0 },
        ] : []);
        setSerpOrigins(askProvenance ? [
          { name: "Italia", value: rel.provenance.find(x => x.label === "italia")?.value || 0 },
          { name: "Germania", value: rel.provenance.find(x => x.label === "germania")?.value || 0 },
          { name: "Francia", value: rel.provenance.find(x => x.label === "francia")?.value || 0 },
          { name: "USA", value: rel.provenance.find(x => x.label === "usa")?.value || 0 },
          { name: "UK", value: rel.provenance.find(x => x.label === "uk")?.value || 0 },
        ] : []);
        setSerpLOS(askLOS ? [
          { bucket: "1 notte", value: rel.los.find(x => x.label === "1 notte")?.value || 0 },
          { bucket: "2-3 notti", value: rel.los.find(x => x.label === "2-3 notti")?.value || 0 },
          { bucket: "4-6 notti", value: rel.los.find(x => x.label === "4-6 notti")?.value || 0 },
          { bucket: "7+ notti", value: rel.los.find(x => x.label === "7+ notti")?.value || 0 },
        ] : []);
      } else {
        setSerpChannels([]); setSerpOrigins([]); setSerpLOS([]);
      }

      // Quota
      const q = await fetch("/api/serp/quota").then(r => r.json()).catch(() => null);
      if (q?.ok) setSerpUsage({ used: q.this_month_usage, total: q.searches_per_month, left: q.plan_searches_left });
      if (j.note) setNotices(prev => Array.from(new Set([...prev, j.note!])));

    } catch {
      setNotices(prev => Array.from(new Set([...prev, "Errore SERP."])));
    }
  }, [aCenter, aQuery, aMonthISO, askTrend, askChannels, askProvenance, askLOS]);

  useEffect(() => { fetchSerp(); }, [fetchSerp]);

  // Calendario: colore cella da pressione
  const dayColor = (v: number) => {
    const t = clamp(v, 0, 100);
    const r = Math.round(255 - (t * 1.6));  // da chiaro a caldo
    const g = Math.round(200 - (t * 0.9));
    const b = Math.round(160 - (t * 0.6));
    return `rgb(${r}, ${g}, ${b})`;
  };

// ===== Block 4/4 =====
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar semplice con quota */}
      <div className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Widget Analisi Domanda — Hospitality</div>
          <div className="text-xs text-slate-600">
            {serpUsage ? (
              <>SERP {serpUsage.used ?? "?"}/{serpUsage.total ?? "?"} (rimasti {serpUsage.left ?? "?"})</>
            ) : <>SERP —</>}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Colonna sinistra: filtri */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-3">Sorgente Dati</div>
            <div className="text-xs text-slate-500">Nessuna (demo)</div>
          </div>

          <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Località</span>
              <input className="flex-1 border rounded px-2 py-1 text-sm"
                     value={query} onChange={e => setQuery(e.target.value)} />
              <button className="px-3 py-1 text-sm rounded bg-slate-900 text-white"
                      onClick={handleSearchLocation}>Cerca</button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm">Raggio</span>
              <select className="border rounded px-2 py-1 text-sm"
                      value={radius} onChange={e => setRadius(Number(e.target.value))}>
                {[10, 20, 30].map(km => <option key={km} value={km}>{km} km</option>)}
              </select>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm">Mese</span>
              <input type="month" className="border rounded px-2 py-1 text-sm"
                     value={aMonthISO.slice(0,7)}
                     onChange={e => setAMonthISO(`${e.target.value}-01`)} />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm">Meteo</span>
              <select className="border rounded px-2 py-1 text-sm"
                      value={wxProvider} onChange={e => setWxProvider(e.target.value as any)}>
                <option value="open-meteo">Open-Meteo (default)</option>
                <option value="openweather">OpenWeather (se configurato)</option>
              </select>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Tipologie</div>
              <select className="border rounded px-2 py-1 text-sm w-full"
                      value={aTypes[0]} onChange={e => setATypes([e.target.value])}>
                {STRUCTURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="pt-2 border-t">
              <div className="text-sm font-medium mb-1">Dati da chiedere alle API</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={askTrend} onChange={e => setAskTrend(e.target.checked)} />
                Andamento domanda (Google Trends)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={askChannels} onChange={e => setAskChannels(e.target.checked)} />
                Canali di vendita
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={askProvenance} onChange={e => setAskProvenance(e.target.checked)} />
                Provenienza clienti
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={askLOS} onChange={e => setAskLOS(e.target.checked)} />
                Durata media soggiorno (LOS)
              </label>
              <div className="text-[11px] text-slate-500 mt-1">
                Spunta solo i grafici che ti servono: risparmi query su SerpAPI.
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t">
              <button
                className={`px-3 py-1 rounded text-sm ${aMode === "zone" ? "bg-slate-900 text-white" : "bg-slate-100"}`}
                onClick={() => setAMode("zone")}
              >Zona</button>
              <button
                className={`px-3 py-1 rounded text-sm ${aMode === "competitor" ? "bg-slate-900 text-white" : "bg-slate-100"}`}
                onClick={() => setAMode("competitor")}
              >Competitor</button>
            </div>

            <div className="pt-2">
              <button
                className="w-full px-3 py-2 rounded bg-slate-900 text-white text-sm"
                onClick={() => {
                  // “Applica” i filtri correnti
                  setAQuery(query); setARadius(radius); setAMonthISO(monthISO); setATypes(types); setAMode(mode);
                  const p = new URLSearchParams();
                  p.set("q", query); p.set("r", String(radius)); p.set("m", monthISO.slice(0, 7));
                  p.set("t", types.join(",")); p.set("mode", mode);
                  p.set("trend", askTrend ? "1" : "0"); p.set("ch", askChannels ? "1" : "0");
                  p.set("prov", askProvenance ? "1" : "0"); p.set("los", askLOS ? "1" : "0");
                  p.set("wx", wxProvider);
                  replaceUrl(router, (typeof window !== "undefined" ? location.pathname : "/"), p);
                  // ricarica SERP
                  setTimeout(() => fetchSerp(), 0);
                }}
              >
                Genera Analisi
              </button>
            </div>
          </div>
        </div>

        {/* Colonna destra: mappa + calendario + grafici */}
        <div className="md:col-span-2 space-y-6">
          {/* Mappa */}
          <div className="bg-white rounded-2xl border shadow-sm p-2 h-[320px] overflow-hidden">
            <LocationMap
              center={aCenter}
              radius={aRadius * 1000}
              label={aQuery}
              onClick={onMapClick}
            />
          </div>

          {/* Calendario domanda + ADR */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="mb-2 text-sm font-semibold">
              Calendario Domanda + ADR — {format(parseISO(aMonthISO), "MMMM yyyy", { locale: it })}
            </div>
            <div className="grid grid-cols-7 gap-3">
              {daysOfMonthWindow(aMonthISO).map((d) => {
                const label = format(d, "d", { locale: it });
                const iso = format(d, "yyyy-MM-dd");
                // trova pressione dal trend
                const p = serpTrend.find(x => x.dateLabel === format(d, "d MMM", { locale: it }))?.value ?? 0;
                const adr = adrFromPressure(p, aMode);
                return (
                  <div key={iso} className="rounded-xl border p-2 text-center"
                       style={{ backgroundColor: dayColor(p), opacity: 0.9 }}>
                    <div className="text-[11px] text-slate-600">{format(d, "EEE", { locale: it })}</div>
                    <div className="text-lg font-semibold">{label}</div>
                    <div className="text-[12px]">€{adr}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
              <span>Bassa domanda</span>
              <div className="h-1 w-24 rounded bg-orange-200" />
              <div className="h-1 w-24 rounded bg-orange-500" />
              <span>Alta domanda</span>
            </div>
          </div>

          {/* Segmenti (placeholder: popolano solo se spuntati) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">Provenienza Clienti</div>
              {serpOrigins.length ? (
                <BarChart width={450} height={220} data={serpOrigins}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" />
                </BarChart>
              ) : (
                <div className="h-40 grid place-items-center text-sm text-slate-500">
                  Nessun segnale utile per questo periodo/area.
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">Durata Media Soggiorno (LOS)</div>
              {serpLOS.length ? (
                <BarChart width={450} height={220} data={serpLOS}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" />
                </BarChart>
              ) : (
                <div className="h-40 grid place-items-center text-sm text-slate-500">
                  Nessun segnale utile per questo periodo/area.
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Canali di Vendita</div>
            {serpChannels.length ? (
              <BarChart width={700} height={260} data={serpChannels}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="channel" />
                <YAxis />
                <RTooltip />
                <Bar dataKey="value" />
              </BarChart>
            ) : (
              <div className="h-48 grid place-items-center text-sm text-slate-500">
                Nessun segnale utile per questo periodo/area.
              </div>
            )}
          </div>

          {/* ===== Andamento domanda — NUOVO AREA CHART ===== */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="mb-2 text-sm font-semibold">
              Andamento domanda — {format(parseISO(`${aMonthISO}`), "MMMM yyyy", { locale: it })}
            </div>

            {(!serpTrend.length || serpTrend.every(p => !p.value)) ? (
              <div className="h-64 grid place-items-center text-sm text-slate-500">
                Nessun segnale utile per questo periodo/area.
              </div>
            ) : (
              <div className="relative h-72">
                <div className="absolute left-0 top-3 bottom-10 w-12 flex flex-col justify-between text-slate-400 text-xs select-none pointer-events-none">
                  <span>Alta</span>
                  <span>Media</span>
                  <span>Bassa</span>
                </div>

                <div className="absolute inset-0 pl-12">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={serpTrend} margin={{ top: 12, right: 6, bottom: 8, left: 0 }}>
                      <defs>
                        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1e3a8a" stopOpacity={0.22} />
                          <stop offset="100%" stopColor="#1e3a8a" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} hide />
                      <RTooltip
                        content={(props: any) => {
                          const { active, payload, label } = props || {};
                          if (!active || !payload?.length) return null;
                          const pressure = Number(payload[0]?.value ?? 0);
                          const adr = adrFromPressure(pressure, aMode);
                          return (
                            <div className="rounded-md border bg-white p-2 text-xs shadow">
                              <div className="font-medium mb-1">{label}</div>
                              <div>Domanda: <b>{Math.round(pressure)}</b></div>
                              <div>ADR stim.: <b>€{adr}</b></div>
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#1e3a8a"
                        strokeWidth={2.2}
                        fill="url(#trendFill)"
                        activeDot={{ r: 3 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notices */}
      {notices.length > 0 && (
        <div className="mx-auto max-w-7xl px-4 md:px-6 pb-8">
          <div className="text-xs text-slate-600">
            {notices.map((n, i) => <div key={i} className="mt-1">• {n}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
