// ===== Block 1/4 =====
// app/widget/App.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, MapPin, Route, RefreshCw, ChevronDown, Check, TrendingUp } from "lucide-react";
import { eachDayOfInterval, format, getDay, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, LineChart, Line, Area, ResponsiveContainer, Legend
} from "recharts";
import { WeatherIcon, codeToKind } from "../../components/WeatherIcon";

// Mappa senza SSR
const LocationMap = dynamic(() => import("../../components/Map"), { ssr: false });

/* ---------- Tipi ---------- */
type LatLng = { lat: number; lng: number };
type Mode = "zone" | "competitor";

type DataRow = {
  date: Date | null;
  adr: number;
  occ: number;
  los: number;
  channel: string;
  provenance: string;
  type: string;
  lat: number;
  lng: number;
};

type Normalized = {
  warnings: string[];
  safeMonthISO: string;
  safeDays: Date[];
  center: (LatLng & { label?: string }) | null;
  safeR: number;
  safeT: string[];
  isBlocked: boolean;
};

type SerpDemandPayload = {
  ok: boolean;
  series?: Array<{ date: string; score: number }>;
  related?: {
    channels: Array<{ label: string; value: number }>;
    provenance: Array<{ label: string; value: number }>;
    los: Array<{ label: string; value: number }>;
  };
  usage?: any;
  note?: string;
};

/* ---------- Snapshot (fallback SERP) ---------- */
type SerpSnapshot = {
  savedAt: number;
  trend: Array<{ dateLabel: string; value: number }>;
  channels: Array<{ channel: string; value: number }>;
  origins: Array<{ name: string; value: number }>;
  los: Array<{ bucket: string; value: number }>;
};

/* ---------- Costanti ---------- */
const WEEKDAYS = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
const STRUCTURE_TYPES = ["hotel","agriturismo","casa_vacanza","villaggio_turistico","resort","b&b","affittacamere"] as const;
const RADIUS_OPTIONS = [10,20,30] as const;

const typeLabels: Record<string,string> = {
  hotel:"Hotel", agriturismo:"Agriturismo", casa_vacanza:"Case Vacanza",
  villaggio_turistico:"Villaggi Turistici", resort:"Resort", "b&b":"B&B", affittacamere:"Affittacamere"
};

/* ---------- Helpers UI ---------- */
function contrastColor(hex: string) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0,2), 16), g = parseInt(c.substring(2,4), 16), b = parseInt(c.substring(4,6), 16);
  const yiq = (r*299 + g*587 + b*114) / 1000;
  return yiq >= 128 ? "#0f172a" : "white";
}
function colorForPressure(v:number, min:number, max:number) {
  if (!Number.isFinite(v)) return "#e2e8f0";
  const t = (v - min) / Math.max(1, (max - min));
  const a = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * (1-a));
  const g = Math.round(255 * (1-a*0.6));
  const b = 255;
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}
function clampRadiusSilently(n?: number|null){
  const v = Number(n||20);
  if (v <= 10) return 10; if (v >= 30) return 30; return v;
}
function daysOfMonthWindow(iso:string){
  const start = startOfMonth(parseISO(iso));
  const end = endOfMonth(parseISO(iso));
  return eachDayOfInterval({ start, end });
}
function safeParseMonthISO(m?:string, warnings:string[]=[]){
  try { const d = parseISO(m||""); if (isNaN(d.getTime())) throw new Error(); return format(d,"yyyy-MM-01"); }
  catch { warnings.push("Mese non valido: reimpostato al mese corrente."); return format(new Date(),"yyyy-MM-01"); }
}
function parseNumParam(v:any, fallback:number){ const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function parseListParam(v:any){ if(!v) return []; if(Array.isArray(v)) return v; return String(v).split(",").map(s=>s.trim()).filter(Boolean); }
function replaceUrlWithState(router:any, pathname:string, state:any){
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.r) p.set("r", String(state.r));
  if (state.m) p.set("m", String(state.m).slice(0,7));
  if (state.t?.length) p.set("t", state.t.join(","));
  if (state.mode) p.set("mode", state.mode);
  if (state.dataSource) p.set("src", state.dataSource);
  if (state.csvUrl) p.set("csv", state.csvUrl);
  if (state.gsId) p.set("id", state.gsId);
  if (state.gsGid) p.set("gid", state.gsGid);
  if (state.gsSheet) p.set("sheet", state.gsSheet);
  if (typeof state.askTrend==="boolean") p.set("trend", state.askTrend ? "1":"0");
  if (typeof state.askChannels==="boolean") p.set("ch", state.askChannels ? "1":"0");
  if (typeof state.askProvenance==="boolean") p.set("prov", state.askProvenance ? "1":"0");
  if (typeof state.askLOS==="boolean") p.set("los", state.askLOS ? "1":"0");
  if (state.wxProvider) p.set("wx", state.wxProvider);
  const url = `${pathname}?${p.toString()}`;
  router.replace(url);
}
function resampleToDays(series: Array<{date:string; score:number}>, monthISO:string){
  const start = startOfMonth(parseISO(monthISO));
  const end = endOfMonth(parseISO(monthISO));
  const monthDays = eachDayOfInterval({ start, end });
  const m = new Map<string, number>();
  series.forEach(p => m.set(p.date.slice(0,10), Number(p.score)||0));
  let lastSeen = 0;
  return monthDays.map(d=>{
    const iso = format(d,"yyyy-MM-dd");
    const v = m.get(iso);
    if (v != null) lastSeen = v;
    return { dateLabel: format(d, "d MMM", { locale: it }), value: lastSeen };
  });
}
function isWithinNextDays(d: Date, daysAhead:number){
  const now = new Date(); const end = new Date(now); end.setDate(now.getDate()+daysAhead);
  return d >= now && d <= end;
}

/* ---------- Snapshot helpers ---------- */
function makeSnapKey(q: string, c: {lat:number; lng:number}|null, mISO: string, t: string[], mode: Mode, r: number){
  const loc = c ? `${c.lat.toFixed(3)},${c.lng.toFixed(3)}` : "n/a";
  return `serpSnap:v1:${q}|${loc}|${mISO.slice(0,7)}|${t.slice().sort().join("+")}|${mode}|r${r}`;
}
function saveSnapshot(key: string, data: SerpSnapshot){
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}
function loadSnapshot(key: string): SerpSnapshot | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as SerpSnapshot : null; }
  catch { return null; }
}

/* ---------- UI components interni (selettori, ecc.) ---------- */
// (MultiSelect Tipologie identico a PAR1: lasciare com’è se già presente)
function MultiSelectTypes({
  value, onChange, labels = typeLabels
}:{ value: string[]; onChange:(v:string[])=>void; labels?:Record<string,string> }){
  const [open, setOpen] = useState(false);
  const allTypes = Object.keys(typeLabels);
  return (
    <div className="relative">
      <button type="button" onClick={()=>setOpen(!open)} className="h-9 w-full rounded-xl border px-3 text-sm flex items-center justify-between">
        <span className="truncate">{value.length ? value.map(v=>labels[v]||v).join(", ") : "Seleziona tipologie"}</span>
        <ChevronDown className="h-4 w-4 opacity-70" />
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-xl border bg-white shadow p-2 space-y-1">
          <ul className="max-h-56 overflow-auto space-y-1" role="listbox">
            {allTypes.map((t) => {
              const active = value.includes(t);
              return (
                <li key={t}>
                  <button
                    type="button"
                    onClick={()=> onChange(active ? value.filter(x=>x!==t) : [...value, t])}
                    className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? "bg-slate-50" : "hover:bg-neutral-50"}`}
                    role="option"
                    aria-selected={active}
                  >
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md border ${active ? "bg-slate-900 border-slate-900" : "bg-white border-neutral-300"}`}>
                      {active ? <Check className="h-3.5 w-3.5 text-white" /> : null}
                    </span>
                    <span className="text-neutral-800">{labels[t] || t}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <button type="button" className="text-xs text-neutral-600 hover:text-neutral-900" onClick={() => onChange([])}>
              Pulisci
            </button>
            <div className="space-x-2">
              <button type="button" className="text-xs text-neutral-600 hover:text-neutral-900" onClick={() => onChange([...allTypes])}>
                Seleziona tutte
              </button>
              <button type="button" className="text-xs rounded-md bg-slate-900 text-white px-2 py-1 hover:bg-slate-800" onClick={() => setOpen(false)}>
                Applica
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ===== Block 2/4 =====
export default function App(){
  const router = useRouter();
  const search = useSearchParams();

  // Notifiche / avvisi
  const [notices, setNotices] = useState<string[]>([]);

  // Filtri UI (PAR1)
  const [mode, setMode] = useState<Mode>("zone");
  const [query, setQuery] = useState("Firenze");
  const [radius, setRadius] = useState<number>(20);
  const [monthISO, setMonthISO] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
  });
  const [types, setTypes] = useState<string[]>(["hotel"]); // default: hotel

  // Meteo provider (client side) — default Open-Meteo
  const [wxProvider, setWxProvider] = useState<"open-meteo"|"openweather">("open-meteo");

  // Selettori SERP (uno per grafico) — PAR1 defaults
  const [askTrend, setAskTrend] = useState(true);
  const [askChannels, setAskChannels] = useState(false);
  const [askProvenance, setAskProvenance] = useState(false);
  const [askLOS, setAskLOS] = useState(false);

  // Dati esterni opzionali (CSV/GSheet) — PAR1
  const [dataSource, setDataSource] = useState<"none"|"csv"|"gsheet">("none");
  const [csvUrl, setCsvUrl] = useState("");
  const [gsId, setGsId] = useState("");
  const [gsSheet, setGsSheet] = useState("Sheet1");
  const [gsGid, setGsGid] = useState("");
  const [strictSheet, setStrictSheet] = useState(true);

  // Caricamenti CSV/GSheet
  const [rawRows, setRawRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Festività + Meteo
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [weatherByDate, setWeatherByDate] = useState<Record<string, { t?: number; p?: number; code?: number }>>({});

  // Stato “applicato”
  const [aQuery, setAQuery] = useState(query);
  const [aRadius, setARadius] = useState(radius);
  const [aMonthISO, setAMonthISO] = useState(monthISO);
  const [aTypes, setATypes] = useState<string[]>(types);
  const [aMode, setAMode] = useState<Mode>(mode);
  const [aCenter, setACenter] = useState<{ lat: number; lng: number } | null>({ lat: 43.7696, lng: 11.2558 });

  // Quota SerpAPI (PAR1)
  const [serpUsage, setSerpUsage] = useState<{ used?: number; total?: number; left?: number } | null>(null);

  // SERP toggles & snapshot (NUOVO)
  const [serpEnabled, setSerpEnabled] = useState(true);                // switch globale ON/OFF
  const [serpConnected, setSerpConnected] = useState<boolean|null>(null); // badge "connesso"
  const [autoFallbackSnap, setAutoFallbackSnap] = useState(true);      // usa snapshot se quota = 0
  const [usingSnapshotTs, setUsingSnapshotTs] = useState<number|null>(null); // info "stai vedendo dati memorizzati"

  // Stato grafici SERP
  const [serpChannels, setSerpChannels] = useState<Array<{ channel: string; value: number }>>([]);
  const [serpOrigins, setSerpOrigins] = useState<Array<{ name: string; value: number }>>([]);
  const [serpLOS, setSerpLOS] = useState<Array<{ bucket: string; value: number }>>([]);
  const [serpTrend, setSerpTrend] = useState<Array<{ dateLabel: string; value: number }>>([]);

  // Flag cambi (PAR1)
  const hasChanges = useMemo(() =>
    aQuery !== query || aRadius !== radius || aMonthISO !== monthISO || aMode !== mode || aTypes.join(",") !== types.join(",") ||
    askTrend !== true || askChannels !== false || askProvenance !== false || askLOS !== false || wxProvider !== "open-meteo",
  [aQuery, query, aRadius, radius, aMonthISO, monthISO, aMode, mode, aTypes, types, askTrend, askChannels, askProvenance, askLOS, wxProvider]);

  // Normalizzazione (PAR1)
  const normalized: Normalized = useMemo(()=>{
    const warnings: string[] = [];
    const center = aCenter;
    const safeR = clampRadiusSilently(aRadius);
    const safeT = aTypes.length ? aTypes.filter(t=> (STRUCTURE_TYPES as readonly string[]).includes(t)) : ["hotel"];
    const safeMonthISO = safeParseMonthISO(aMonthISO, warnings);
    const safeDays = daysOfMonthWindow(safeMonthISO);
    return { warnings, safeMonthISO, safeDays, center: center ?? null, safeR, safeT, isBlocked: !center };
  }, [aMonthISO, aRadius, aTypes, aCenter]);

  // Avvisi da normalized
  useEffect(() => {
    setNotices(prev => (prev.join("|") === normalized.warnings.join("|") ? prev : normalized.warnings));
  }, [normalized.warnings]);

  // Leggi stato da URL al mount (PAR1)
  useEffect(() => {
    if (!search) return;
    const q = search.get("q") ?? "Firenze";
    const r = parseNumParam(search.get("r"), radius);
    const m = search.get("m") ? `${search.get("m")}-01` : monthISO;
    const rawT = parseListParam(search.get("t"));
    const validT = rawT.filter(x => (STRUCTURE_TYPES as readonly string[]).includes(x));
    const t = validT.length ? validT : ["hotel"];
    const modeParam: Mode = (search.get("mode") === "competitor" ? "competitor" : "zone");

    const src = (search.get("src") as "none"|"csv"|"gsheet") ?? dataSource;
    const csv = search.get("csv") ?? csvUrl;
    const id  = search.get("id")  ?? gsId;
    const gid = search.get("gid") ?? gsGid;
    const sheet = search.get("sheet") ?? gsSheet;

    const trendQ = search.get("trend"); const chQ = search.get("ch"); const prQ = search.get("prov"); const losQ = search.get("los");
    const wx = (search.get("wx") as "open-meteo"|"openweather") || "open-meteo";

    setQuery(q); setRadius(r); setMonthISO(m); setTypes(t); setMode(modeParam);
    setAQuery(q); setARadius(r); setAMonthISO(m); setATypes(t); setAMode(modeParam);

    setDataSource(src); setCsvUrl(csv); setGsId(id); setGsGid(gid||""); setGsSheet(sheet||"Sheet1");
    setAskTrend(trendQ !== "0"); setAskChannels(chQ === "1"); setAskProvenance(prQ === "1"); setAskLOS(losQ === "1");
    setWxProvider(wx);
  }, [search]);

  // Reset PAR1 (Firenze)
  const handleReset = useCallback(() => {
    const now = new Date();
    const m = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
    setQuery("Firenze"); setRadius(20); setMonthISO(m); setTypes(["hotel"]); setMode("zone");
    setAQuery("Firenze"); setARadius(20); setAMonthISO(m); setATypes(["hotel"]); setAMode("zone"); setACenter({ lat: 43.7696, lng: 11.2558 });
    setAskTrend(true); setAskChannels(false); setAskProvenance(false); setAskLOS(false); setWxProvider("open-meteo");
    setNotices([]); setWeatherByDate({});
    replaceUrlWithState(router, (typeof window !== "undefined" ? location.pathname : "/"), {
      q: "Firenze", r: 20, m, t: ["hotel"], mode: "zone",
      dataSource, csvUrl, gsId, gsGid, gsSheet,
      askTrend: true, askChannels: false, askProvenance: false, askLOS: false, wxProvider: "open-meteo"
    });
  }, [router, dataSource, csvUrl, gsId, gsGid, gsSheet]);

  // Geocoding ricerca (PAR1)
  const handleSearchLocation = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    try {
      const r = await fetch(`/api/external/geocode?q=${encodeURIComponent(q)}`);
      const j = r.ok ? await r.json() : null;
      const item = (j?.results||[])[0];
      const lat = Number(item?.lat); const lng = Number(item?.lng);
      const name = String(item?.name ?? item?.display_name ?? q);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setACenter({ lat, lng }); setAQuery(name);
        setARadius(radius); setAMonthISO(monthISO); setATypes(types); setAMode(mode);
        replaceUrlWithState(router, (typeof window !== "undefined" ? location.pathname : "/"),
          { q: name, r: radius, m: monthISO, t: types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet, askTrend, askChannels, askProvenance, askLOS, wxProvider });
      } else { alert("Località non trovata"); }
    } catch { alert("Errore di geocoding"); }
  }, [query, radius, monthISO, types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet, askTrend, askChannels, askProvenance, askLOS, wxProvider, router]);

  // Reverse geocoding (click mappa) (PAR1)
  const onMapClick = useCallback(async ({ lat, lng }: { lat: number; lng: number }) => {
    let name = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try { const r = await fetch(`/api/external/reverse-geocode?lat=${lat}&lng=${lng}`); const j = r.ok ? await r.json() : null; if (j) name = String(j?.name ?? j?.display_name ?? name); } catch {}
    setQuery(name);
    setACenter({ lat, lng }); setAQuery(name);
    setARadius(radius); setAMonthISO(monthISO); setATypes(types); setAMode(mode);
    replaceUrlWithState(router, (typeof window !== "undefined" ? location.pathname : "/"),
      { q: name, r: radius, m: monthISO, t: types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet, askTrend, askChannels, askProvenance, askLOS, wxProvider });
  }, [radius, monthISO, types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet, askTrend, askChannels, askProvenance, askLOS, wxProvider, router]);

  /* ----- Festività IT (PAR1) ----- */
  useEffect(() => {
    const y = Number(aMonthISO.slice(0, 4));
    if (!y) return;
    fetch(`/api/external/holidays?year=${y}&country=IT`)
      .then(r => r.json())
      .then((j) => {
        if (!j?.ok) return;
        const map: Record<string, string> = {};
        (j.holidays || []).forEach((h: any) => { map[h.date] = h.localName || h.name; });
        setHolidays(map);
      })
      .catch(() => {});
  }, [aMonthISO]);

  /* ----- Meteo (PAR1) ----- */
  useEffect(() => {
    if (!normalized.center || !aMonthISO) { setWeatherByDate({}); return; }
    const { lat, lng } = normalized.center;
    const url = `/api/external/weather?lat=${lat}&lng=${lng}&monthISO=${encodeURIComponent(aMonthISO)}&provider=${wxProvider}`;
    fetch(url)
      .then(r => r.json())
      .then((j) => {
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
      })
      .catch(() => setWeatherByDate({}));
  }, [normalized.center, aMonthISO, wxProvider]);

  // Badge “SerpAPI connesso” (NUOVO)
  useEffect(() => {
    (async () => {
      try {
        const q = await fetch("/api/serp/quota").then(r=>r.json());
        if (q?.ok) {
          setSerpUsage({
            used:  q.this_month_usage ?? q.raw?.this_month_usage,
            total: q.searches_per_month ?? q.raw?.searches_per_month,
            left:  q.plan_searches_left ?? q.raw?.plan_searches_left,
          });
          setSerpConnected(true);
        } else {
          setSerpConnected(false);
        }
      } catch { setSerpConnected(false); }
    })();
  }, []);
// ===== Block 3/4 =====
  /* ----- SERPAPI: linea + segmenti + quota + snapshot (NUOVO) ----- */
  const fetchSerp = useCallback(async () => {
    if (!aCenter) return;

    const needTrend   = askTrend;
    const needRelated = askChannels || askProvenance || askLOS;
    if (!needTrend && !needRelated) return;

    // Chiave snapshot per questo contesto
    const snapKey = makeSnapKey(aQuery, aCenter, aMonthISO, aTypes, aMode, aRadius);

    // Se lo switch è OFF → usa solo snapshot
    if (!serpEnabled) {
      const snap = loadSnapshot(snapKey);
      if (snap) {
        setSerpTrend(snap.trend); setSerpChannels(snap.channels);
        setSerpOrigins(snap.origins); setSerpLOS(snap.los);
        setUsingSnapshotTs(snap.savedAt);
        setNotices(prev => Array.from(new Set([...prev, "SERP disattivato: uso dati memorizzati."])));
      } else {
        setNotices(prev => Array.from(new Set([...prev, "SERP disattivato e nessun dataset memorizzato."])));
        setSerpTrend([]); setSerpChannels([]); setSerpOrigins([]); setSerpLOS([]); setUsingSnapshotTs(null);
      }
      return;
    }

    try {
      const params = new URLSearchParams({
        q: `${aQuery} hotel`,
        lat: String(aCenter.lat),
        lng: String(aCenter.lng),
        date: "today 12-m",
        cat: "203",
        parts: [
          needTrend ? "trend" : "",
          needRelated ? "related" : ""
        ].filter(Boolean).join(","),
      });
      // Indica al backend quali bucket related vogliamo
      params.set("ch", String(+askChannels));
      params.set("prov", String(+askProvenance));
      params.set("los", String(+askLOS));

      const r = await fetch(`/api/serp/demand?${params.toString()}`);
      const j: SerpDemandPayload = await r.json();

      if (!j?.ok) {
        setNotices(prev => Array.from(new Set([...prev, (j as any)?.error || "Errore richiesta SERP: uso dati dimostrativi."])));
        return;
      }

      // Quota parziale
      let badge = {
        used: j.usage?.this_month_usage,
        total: j.usage?.searches_per_month,
        left: j.usage?.plan_searches_left
      } as any;

      // Aggiorna grafici
      if (needTrend && Array.isArray(j.series)) {
        setSerpTrend(resampleToDays(j.series, aMonthISO));
      } else if (!needTrend) {
        setSerpTrend([]);
      }

      if (needRelated && j.related) {
        const rel = j.related;
        if (askChannels) {
          setSerpChannels([
            { channel: "Booking",  value: rel.channels.find((x)=>x.label==="booking")?.value || 0 },
            { channel: "Airbnb",   value: rel.channels.find((x)=>x.label==="airbnb")?.value || 0 },
            { channel: "Diretto",  value: rel.channels.find((x)=>x.label==="diretto")?.value || 0 },
            { channel: "Expedia",  value: rel.channels.find((x)=>x.label==="expedia")?.value || 0 },
            { channel: "Altro",    value: rel.channels.find((x)=>x.label==="altro")?.value || 0 },
          ]);
        } else { setSerpChannels([]); }

        if (askProvenance) {
          setSerpOrigins([
            { name: "Italia",   value: rel.provenance.find((x)=>x.label==="italia")?.value || 0 },
            { name: "Germania", value: rel.provenance.find((x)=>x.label==="germania")?.value || 0 },
            { name: "Francia",  value: rel.provenance.find((x)=>x.label==="francia")?.value || 0 },
            { name: "USA",      value: rel.provenance.find((x)=>x.label==="usa")?.value || 0 },
            { name: "UK",       value: rel.provenance.find((x)=>x.label==="uk")?.value || 0 },
          ]);
        } else { setSerpOrigins([]); }

        if (askLOS) {
          setSerpLOS([
            { bucket: "1 notte",  value: rel.los.find((x)=>x.label==="1 notte")?.value || 0 },
            { bucket: "2-3 notti",value: rel.los.find((x)=>x.label==="2-3 notti")?.value || 0 },
            { bucket: "4-6 notti",value: rel.los.find((x)=>x.label==="4-6 notti")?.value || 0 },
            { bucket: "7+ notti", value: rel.los.find((x)=>x.label==="7+ notti")?.value || 0 },
          ]);
        } else { setSerpLOS([]); }
      }

      if (j.note) setNotices(prev => Array.from(new Set([...prev, j.note!])));

      // Merge quota con /api/serp/quota (badge completo) + stato "connesso"
      try {
        const q = await fetch("/api/serp/quota").then(r=>r.json());
        if (q?.ok) {
          badge.used  = badge.used  ?? q.this_month_usage;
          badge.total = badge.total ?? q.searches_per_month ?? q.raw?.searches_per_month;
          badge.left  = badge.left  ?? q.plan_searches_left ?? q.raw?.plan_searches_left;
          setSerpConnected(true);
        } else {
          setSerpConnected(false);
        }
      } catch { setSerpConnected(false); }
      setSerpUsage(badge);

      // Salva snapshot locale
      const snap: SerpSnapshot = {
        savedAt: Date.now(),
        trend: Array.isArray(j.series) ? resampleToDays(j.series, aMonthISO) : [],
        channels: [
          { channel: "Booking",  value: j.related?.channels.find(x=>x.label==="booking")?.value || 0 },
          { channel: "Airbnb",   value: j.related?.channels.find(x=>x.label==="airbnb")?.value || 0 },
          { channel: "Diretto",  value: j.related?.channels.find(x=>x.label==="diretto")?.value || 0 },
          { channel: "Expedia",  value: j.related?.channels.find(x=>x.label==="expedia")?.value || 0 },
          { channel: "Altro",    value: j.related?.channels.find(x=>x.label==="altro")?.value || 0 },
        ],
        origins: [
          { name: "Italia",   value: j.related?.provenance.find(x=>x.label==="italia")?.value || 0 },
          { name: "Germania", value: j.related?.provenance.find(x=>x.label==="germania")?.value || 0 },
          { name: "Francia",  value: j.related?.provenance.find(x=>x.label==="francia")?.value || 0 },
          { name: "USA",      value: j.related?.provenance.find(x=>x.label==="usa")?.value || 0 },
          { name: "UK",       value: j.related?.provenance.find(x=>x.label==="uk")?.value || 0 },
        ],
        los: [
          { bucket: "1 notte",  value: j.related?.los.find(x=>x.label==="1 notte")?.value || 0 },
          { bucket: "2-3 notti",value: j.related?.los.find(x=>x.label==="2-3 notti")?.value || 0 },
          { bucket: "4-6 notti",value: j.related?.los.find(x=>x.label==="4-6 notti")?.value || 0 },
          { bucket: "7+ notti", value: j.related?.los.find(x=>x.label==="7+ notti")?.value || 0 },
        ],
      };
      saveSnapshot(snapKey, snap);
      setUsingSnapshotTs(null);

      // Quota finita → fallback automatico
      if (autoFallbackSnap && typeof badge.left === "number" && badge.left <= 0) {
        const off = loadSnapshot(snapKey);
        if (off) {
          setSerpTrend(off.trend); setSerpChannels(off.channels);
          setSerpOrigins(off.origins); setSerpLOS(off.los);
          setUsingSnapshotTs(off.savedAt);
          setNotices(prev => Array.from(new Set([...prev, "Quota SerpAPI esaurita: uso dati memorizzati."])));
        } else {
          setNotices(prev => Array.from(new Set([...prev, "Quota SerpAPI esaurita: nessun dataset memorizzato."])));
        }
      }
    } catch {
      setNotices(prev => Array.from(new Set([...prev, "Errore richiesta SERP: uso dati dimostrativi."])));
    }
  }, [aQuery, aCenter, aMonthISO, askTrend, askChannels, askProvenance, askLOS, serpEnabled, autoFallbackSnap, aTypes, aMode, aRadius]);

  useEffect(() => { fetchSerp(); }, [fetchSerp]);

  /* ----- CSV/Google Sheet (PAR1) ----- */
  useEffect(() => {
    if (dataSource === "none") return;
    setLoading(true);
    (async () => {
      try {
        let url = "";
        if (dataSource === "csv") url = csvUrl.trim();
        else {
          if (!gsId) throw new Error("Sheet ID mancante");
          url = strictSheet
            ? `https://docs.google.com/spreadsheets/d/${gsId}/export?format=csv&gid=${encodeURIComponent(gsGid||"0")}`
            : `https://docs.google.com/spreadsheets/d/${gsId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(gsSheet||"Sheet1")}`;
        }
        const txt = await fetch(url).then(r=>r.text());
        const lines = txt.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) { setRawRows([]); return; }
        const delim = lines[0].includes(";") ? ";" : ",";
        const headers = lines[0].split(delim).map(h=>h.toLowerCase().trim());
        const rows = lines.slice(1).map(line=>{
          const cells = line.split(delim);
          const obj: any = {};
          headers.forEach((h,i)=>obj[h]=cells[i]??"");
          return obj;
        });
        const toNum = (v:string)=> Number(String(v).replace(",","."));
        const toD = (v:string)=> new Date(v);
        const norm: DataRow[] = rows.map((r:any)=>({
          date: toD(r.date||r.data||r.giorno),
          adr: toNum(r.adr||r.adr_medio||r.prezzo_medio)||0,
          occ: toNum(r.occ||r.occupazione||r.occ_rate)||0,
          los: toNum(r.los||r.notti||r.soggiorno)||0,
          channel: r.channel||r.canale||"Altro",
          provenance: r.provenance||r.country||r.nazione||"Altro",
          type: r.type||r.tipo||"",
          lat: toNum(r.lat||r.latitude)||0,
          lng: toNum(r.lng||r.longitude)||0,
        })).filter(r=>!!r.date);
        setRawRows(norm);
      } catch (e:any) {
        setLoadError(String(e?.message||e));
      } finally { setLoading(false); }
    })();
  }, [dataSource, csvUrl, gsId, gsGid, gsSheet, strictSheet]);

  // Derivazioni calendario (PAR1)
  const monthDate = useMemo(()=> {
    if(!aMonthISO) return new Date();
    try { return parseISO(aMonthISO); } catch { return new Date(); }
  }, [aMonthISO]);

  /** --- Helpers (PAR1) - domanda/ADR demo --- */
  function pressureFor(date: Date){
    const dow = getDay(date);
    const base = 60 + (date.getDate() * 2);
    const wkndBoost = (dow === 0 || dow === 6) ? 25 : (dow === 5 ? 18 : 0);
    return base + wkndBoost;
  }

  function adrFromCompetitors(date: Date, mode: Mode){
    const base = 80 + (date.getDate() % 7) * 3;
    return Math.round(base + (mode === "competitor" ? 12 : 0));
  }

// ===== Block 4/4 =====
  // Calendario (pressione + adr dimostrativi)
  const calendarData = useMemo(() => {
    const days = daysOfMonthWindow(aMonthISO);
    return days.map(d => ({
      date: d,
      pressure: pressureFor(d),
      adr: adrFromCompetitors(d, aMode),
      holidayName: holidays[format(d,"yyyy-MM-dd")],
      wx: weatherByDate[format(d,"yyyy-MM-dd")] || undefined,
    }));
  }, [aMonthISO, aMode, holidays, weatherByDate]);

  const provenance = useMemo(() => (serpOrigins.length > 0 ? serpOrigins : []), [serpOrigins]);
  const los = useMemo(() => (serpLOS.length > 0 ? serpLOS : []), [serpLOS]);
  const channels = useMemo(() => (serpChannels.length > 0 ? serpChannels : []), [serpChannels]);

  const meteoCovered = useMemo(
    () => calendarData.filter((d: any) => d?.wx?.code != null && isWithinNextDays(d.date, 7)).length,
    [calendarData]
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar */}
      <div className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Widget Analisi Domanda – Hospitality</h1>
            {(serpUsage?.used != null || serpUsage?.left != null || serpUsage?.total != null) && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-white" title="Quota SerpAPI (mese corrente)">
                <TrendingUp className="h-3.5 w-3.5" />
                SERP {serpUsage.used ?? "?"}/{serpUsage.total ?? "?"} (rimasti {serpUsage.left ?? "?"})
              </span>
            )}
          </div>
          <button
            className="px-3 py-2 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-800"
            onClick={handleReset}
            title="Reset"
          >
            <span className="inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Reset</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        {/* SIDEBAR */}
        <aside className="space-y-6">
          {/* Sorgente dati opzionale */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <div className="text-sm font-semibold">Sorgente Dati</div>
            <div className="flex items-center gap-2">
              <label className="w-28 text-sm text-slate-700">Tipo</label>
              <select
                className="h-9 rounded-xl border border-slate-300 px-2 text-sm w-full"
                value={dataSource}
                onChange={(e) => setDataSource(e.target.value as any)}
              >
                <option value="none">Nessuna (demo)</option>
                <option value="csv">CSV URL</option>
                <option value="gsheet">Google Sheet</option>
              </select>
            </div>
            {dataSource === "csv" && (
              <div className="flex items-center gap-2">
                <label className="w-28 text-sm text-slate-700">CSV URL</label>
                <input
                  className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm"
                  value={csvUrl}
                  onChange={(e) => setCsvUrl(e.target.value)}
                  placeholder="https://…&tqx=out:csv&sheet=Foglio1"
                />
              </div>
            )}
            {dataSource === "gsheet" && (
              <>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Sheet ID</label>
                  <input
                    className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm"
                    value={gsId}
                    onChange={(e) => setGsId(e.target.value)}
                    placeholder="1AbC…"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Sheet</label>
                  <input
                    className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm"
                    value={gsSheet}
                    onChange={(e) => setGsSheet(e.target.value)}
                    placeholder="Sheet1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">GID</label>
                  <input
                    className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm"
                    value={gsGid}
                    onChange={(e) => setGsGid(e.target.value)}
                    placeholder="es. 0 (#gid=…)"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Modalità</label>
                  <div className="flex items-center gap-2">
                    <input id="strict" type="checkbox" checked={strictSheet} onChange={(e) => setStrictSheet(e.currentTarget.checked)} />
                    <label htmlFor="strict" className="text-sm">Rigida (consigliata)</label>
                  </div>
                </div>
              </>
            )}
            {loading && <div className="text-xs text-slate-600">Caricamento dati…</div>}
            {loadError && <div className="text-xs text-rose-600">Errore sorgente: {loadError}</div>}
            {rawRows.length > 0 && <div className="text-xs text-emerald-700">Dati caricati: {rawRows.length} righe</div>}
          </section>

          {/* Località / Raggio / Mese / Tipologie / Meteo provider */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-slate-700" />
              <label className="w-28 text-sm text-slate-700">Località</label>
              <div className="flex gap-2 w-full">
                <input
                  className="border rounded px-2 h-9 w-full"
                  placeholder="Città o indirizzo"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSearchLocation(); } }}
                />
                <button type="button" className="px-3 h-9 rounded border bg-white hover:bg-slate-50" onClick={handleSearchLocation}>
                  Cerca
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Route className="h-5 w-5 text-slate-700" />
              <label className="w-28 text-sm text-slate-700">Raggio</label>
              <select
                className="h-9 rounded-xl border border-slate-300 px-2 text-sm w-40"
                value={String(radius)}
                onChange={(e) => setRadius(parseInt(e.target.value))}
              >
                {RADIUS_OPTIONS.map(r => <option key={r} value={r}>{r} km</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-slate-700" />
              <label className="w-28 text-sm text-slate-700">Mese</label>
              <input
                type="month"
                value={monthISO ? monthISO.slice(0, 7) : ""}
                onChange={e => setMonthISO(`${e.target.value || ""}-01`)}
                className="w-48 h-9 rounded-xl border border-slate-300 px-2 text-sm"
              />
            </div>

            <TypesMultiSelect
              value={types}
              onChange={setTypes}
              allTypes={STRUCTURE_TYPES}
              labels={typeLabels}
            />

            <div className="flex items-center gap-2">
              <label className="w-28 text-sm text-slate-700">Meteo</label>
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="wx" checked={wxProvider === "open-meteo"} onChange={() => setWxProvider("open-meteo")} />
                  Open-Meteo
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="wx" checked={wxProvider === "openweather"} onChange={() => setWxProvider("openweather")} />
                  OpenWeather (demo)
                </label>
              </div>
            </div>

            {/* SERP & diagnostica */}
            <div className="mt-2 border-t pt-3 space-y-2">
              <div className="text-sm font-semibold">Dati Esterni (Google Trends via SerpAPI)</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={askTrend} onChange={(e) => setAskTrend(e.currentTarget.checked)} />
                  Andamento
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={askChannels} onChange={(e) => setAskChannels(e.currentTarget.checked)} />
                  Canali
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={askProvenance} onChange={(e) => setAskProvenance(e.currentTarget.checked)} />
                  Provenienza
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={askLOS} onChange={(e) => setAskLOS(e.currentTarget.checked)} />
                  LOS
                </label>
              </div>

              <div>
                <div className="text-xs text-slate-600 mb-2">
                  {serpUsage?.used != null && serpUsage?.total != null
                    ? <>Quota SERP usata: <b>{serpUsage.used}</b> / {serpUsage.total} (rimasti {serpUsage.left ?? "?"})</>
                    : <>Quota SERP non rilevata</>}
                </div>

                <button
                  className="w-full inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border bg-slate-900 text-white border-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    const next = {
                      q: query, r: radius, m: monthISO, t: types, mode,
                      dataSource, csvUrl, gsId, gsGid, gsSheet,
                      askTrend, askChannels, askProvenance, askLOS, wxProvider
                    };
                    setAQuery(next.q); setARadius(next.r); setAMonthISO(next.m); setATypes(next.t); setAMode(next.mode);
                    if (!aCenter) setACenter({ lat: 43.7696, lng: 11.2558 });
                    const url = replaceUrlWithState(router, (typeof window !== "undefined" ? location.pathname : "/"), next);
                    setShareUrl(url);
                    fetchSerp();
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Genera Analisi
                </button>

                {shareUrl && (
                  <div className="mt-2">
                    <label className="block text-xs text-slate-600 mb-1">Link condivisibile</label>
                    <input
                      className="w-full h-9 rounded-xl border border-slate-300 px-2 text-xs"
                      value={typeof window !== "undefined" ? `${location.origin}${shareUrl}` : shareUrl}
                      readOnly
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Avvisi */}
          {notices.length > 0 && (
            <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="text-sm font-semibold text-amber-900">Avvisi</div>
              <ul className="list-disc ml-5 text-sm text-amber-900">
                {notices.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </section>
          )}
        </aside>

        {/* MAIN */}
        <main className="space-y-6">
          {/* MAPPA */}
          <div className="bg-white rounded-2xl border shadow-sm p-0">
            <div className="h-72 md:h-[400px] lg:h-[480px] overflow-hidden rounded-2xl">
              <LocationMap
                center={normalized.center ? { lat: normalized.center.lat, lng: normalized.center.lng } : null}
                radius={normalized.safeR * 1000}
                label={aQuery || "Località"}
                onClick={onMapClick}
              />
            </div>
          </div>

          {/* CALENDARIO */}
          <div className="bg-white rounded-2xl border shadow-sm p-6">
            <div className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span>Calendario Domanda + ADR – {format(monthDate, "LLLL yyyy", { locale: it })}</span>
              {meteoCovered > 0 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
                  Meteo attivo · {meteoCovered} gg
                </span>
              )}
            </div>
            <CalendarHeatmap monthDate={monthDate} data={calendarData} />
          </div>

          {/* Grafici: Provenienza + LOS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">Provenienza Clienti</div>

              {provenance.length === 0 || provenance.every(x => (x.value || 0) === 0) ? (
                <div className="h-56 flex items-center justify-center text-sm text-slate-500">
                  Nessun segnale utile per questo periodo/area.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={360}>
                  <PieChart margin={{ bottom: 24 }}>
                    <defs>
                      {provenance.map((_, i) => {
                        const base = solidColor(i);
                        return (
                          <linearGradient key={i} id={`gradSlice-${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={shade(base, 0.25)} />
                            <stop offset="100%" stopColor={shade(base, -0.12)} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                    <Pie
                      data={provenance}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={THEME.chart.pie.innerRadius}
                      outerRadius={THEME.chart.pie.outerRadius}
                      paddingAngle={THEME.chart.pie.paddingAngle}
                      cornerRadius={THEME.chart.pie.cornerRadius}
                      labelLine={false}
                      label={({ percent }) => `${Math.round((percent || 0) * 100)}%`}
                      isAnimationActive
                      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,15))" }}
                    >
                      {provenance.map((_, i) => (
                        <Cell key={i} fill={`url(#gradSlice-${i})`} stroke="#ffffff" strokeWidth={2} />
                      ))}
                    </Pie>
                    <RTooltip />
                    <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ color: "#111827", fontWeight: 600 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">Durata Media Soggiorno (LOS)</div>

              {los.length === 0 || los.every(x => (x.value || 0) === 0) ? (
                <div className="h-48 flex items-center justify-center text-sm text-slate-500">
                  Nessun segnale utile per questo periodo/area.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={los} margin={THEME.chart.bar.margin}>
                    <defs>
                      {los.map((_, i) => {
                        const base = THEME.palette.barBlue[i % THEME.palette.barBlue.length];
                        return (
                          <linearGradient key={i} id={`gradBarLOS-${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={shade(base, 0.2)} />
                            <stop offset="100%" stopColor={shade(base, -0.15)} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" tick={{ fontSize: THEME.chart.bar.tickSize }} />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {los.map((_, i) => (<Cell key={i} fill={`url(#gradBarLOS-${i})`} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Canali */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Canali di Vendita</div>

            {channels.length === 0 || channels.every(x => (x.value || 0) === 0) ? (
              <div className="h-56 flex items-center justify-center text-sm text-slate-500">
                Nessun segnale utile per questo periodo/area.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={channels} margin={THEME.chart.barWide.margin}>
                  <defs>
                    {channels.map((_, i) => {
                      const base = THEME.palette.barOrange[i % THEME.palette.barOrange.length];
                      return (
                        <linearGradient key={i} id={`gradBarCH-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={shade(base, 0.18)} />
                          <stop offset="100%" stopColor={shade(base, -0.15)} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="channel" interval={0} tick={{ fontSize: THEME.chart.barWide.tickSize }} height={40} />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {channels.map((_, i) => (<Cell key={i} fill={`url(#gradBarCH-${i})`} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Andamento Domanda */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Andamento Domanda – {format(monthDate, "LLLL yyyy", { locale: it })}</div>

            {serpTrend.length === 0 || serpTrend.every(p => (p.value || 0) === 0) ? (
              <div className="h-56 flex items-center justify-center text-sm text-slate-500">
                Nessun segnale (serie tutta a zero). Prova ad ampliare l’area o il periodo.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={serpTrend}>
                  <defs>
                    <linearGradient id="gradLineStroke" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={shade(THEME.chart.line.stroke, 0.15)} />
                      <stop offset="100%" stopColor={shade(THEME.chart.line.stroke, -0.10)} />
                    </linearGradient>
                    <linearGradient id="gradLineFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={shade(THEME.chart.line.stroke, 0.25)} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={shade(THEME.chart.line.stroke, -0.20)} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 12 }} interval={3} />
                  <YAxis />
                  <RTooltip />
                  <Area type="monotone" dataKey="value" fill="url(#gradLineFill)" stroke="none" isAnimationActive />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="url(#gradLineStroke)"
                    strokeWidth={THEME.chart.line.strokeWidth + 0.5}
                    dot={{ r: THEME.chart.line.dotRadius + 1, stroke: "#fff", strokeWidth: 1 }}
                    activeDot={{ r: THEME.chart.line.dotRadius + 2, stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
