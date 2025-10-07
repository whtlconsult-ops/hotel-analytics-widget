// app/widget/App.tsx
"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, MapPin, Route, RefreshCw, ChevronDown, Check, TrendingUp } from "lucide-react";
import { eachDayOfInterval, format, getDay, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { http } from "../../lib/http";
import { cityFromTopic, seasonalityItaly12, last12LabelsLLLyy, normalizeTo100, blend3 } from "../../lib/baseline";
import { it } from "date-fns/locale";
import {
  XAxis, YAxis, CartesianGrid, LineChart, Line, Area, ResponsiveContainer, Tooltip as RTooltip
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

const WEEKDAYS = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
const STRUCTURE_TYPES = ["hotel","agriturismo","casa_vacanza","villaggio_turistico","resort","b&b","affittacamere"] as const;
const RADIUS_OPTIONS = [10,20,30] as const;

const typeLabels: Record<string,string> = {
  hotel:"Hotel", agriturismo:"Agriturismo", casa_vacanza:"Case Vacanza",
  villaggio_turistico:"Villaggi Turistici", resort:"Resort", "b&b":"B&B", affittacamere:"Affittacamere"
};

const THEME = {
  chart: {
    line: { stroke: "#1e3a8a", strokeWidth: 2, dotRadius: 2 },
    pie:  { innerRadius: 60, outerRadius: 100, paddingAngle: 2, cornerRadius: 6 },
    bar:  { margin: { top: 16, right: 16, left: 8, bottom: 16 }, tickSize: 12 },
    barWide: { margin: { top: 8, right: 16, left: 8, bottom: 24 }, tickSize: 11 },
  },
  palette: {
    solid: ["#ef4444","#f59e0b","#10b981","#3b82f6","#8b5cf6","#22c55e","#eab308","#06b6d4"],
    barBlue:   ["#60a5fa","#3b82f6","#2563eb","#1d4ed8","#1e40af"],
    barOrange: ["#fdba74","#fb923c","#f97316","#ea580c","#c2410c"],
  }
};
const solidColor = (i:number)=> THEME.palette.solid[i % THEME.palette.solid.length];

/* ---------- Utilità ---------- */
function shade(hex: string, percent: number) {
  const m = hex.replace('#',''); const num = parseInt(m, 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + Math.round(255 * percent)));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + Math.round(255 * percent)));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + Math.round(255 * percent)));
  return `#${(1 << 24 | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
function pressureFor(date: Date){
  const dow = getDay(date);
  const base = 60 + (date.getDate()*2);
  const wkndBoost = (dow===0 || dow===6) ? 25 : (dow===5 ? 18 : 0);
  return base + wkndBoost;
}
function adrFromCompetitors(date: Date, mode: Mode){
  const base = 80 + (date.getDate()%7)*3;
  return Math.round(base + (mode==="competitor"? 12:0));
}
function colorForPressure(p:number, pmin:number, pmax:number){
  const spread = Math.max(1,(pmax-pmin));
  const t = (p - pmin) / spread;
  const stops = [[255,255,204],[255,237,160],[254,217,118],[254,178,76],[253,141,60],[252,78,42],[227,26,28]];
  const idx = Math.min(stops.length-1, Math.max(0, Math.floor(t*(stops.length-1))));
  const [r,g,b] = stops[idx];
  return `rgb(${r},${g},${b})`;
}
function contrastColor(rgb:string){
  const m = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if(!m) return "#000";
  const r = +m[1], g=+m[2], b=+m[3];
  const brightness = 0.299*r + 0.587*g + 0.114*b;
  return brightness < 150 ? "#fff" : "#000";
}
function safeParseMonthISO(v:string|undefined|null, warnings:string[]): string{
  const now = new Date();
  const def = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  if(!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)){ warnings.push("Mese non valido: fallback al mese corrente"); return def; }
  return v;
}
function daysOfMonthWindow(monthISO: string): Date[] {
  const m = parseISO(monthISO);
  return eachDayOfInterval({ start: startOfMonth(m), end: endOfMonth(m) });
}
function clampRadiusSilently(r:number){
  if (!Number.isFinite(r)) return 20;
  return Math.max(1, Math.min(50, Math.round(r)));
}
function parseListParam(s?: string | null) { if (!s) return []; return s.split(",").map(decodeURIComponent).map(v => v.trim()).filter(Boolean); }
function parseNumParam(s?: string | null, def = 0) { const n = Number(s); return Number.isFinite(n) ? n : def; }
function makeShareUrl(pathname: string, opts: {
  q: string; r: number; m: string; t: string[]; mode: Mode;
  dataSource: "none"|"csv"|"gsheet"; csvUrl: string; gsId: string; gsGid: string; gsSheet: string;
  askTrend: boolean; askChannels: boolean; askProvenance: boolean; askLOS: boolean; wxProvider: string;
}) {
  const params = new URLSearchParams();
  params.set("q", opts.q);
  params.set("r", String(opts.r));
  params.set("m", opts.m.slice(0,7));
  params.set("mode", opts.mode);
  if (opts.t.length > 0 && opts.t.length < (STRUCTURE_TYPES as readonly string[]).length) {
    params.set("t", opts.t.map(encodeURIComponent).join(","));
  }
  params.set("trend", String(+opts.askTrend));
  params.set("ch", String(+opts.askChannels));
  params.set("prov", String(+opts.askProvenance));
  params.set("los", String(+opts.askLOS));
  params.set("wx", opts.wxProvider);
  if (opts.dataSource === "csv" && opts.csvUrl) { params.set("src","csv"); params.set("csv", opts.csvUrl); }
  else if (opts.dataSource === "gsheet" && opts.gsId) { params.set("src","gsheet"); params.set("id",opts.gsId); if (opts.gsGid) params.set("gid",opts.gsGid); if (opts.gsSheet) params.set("sheet",opts.gsSheet); }
  return `${pathname}?${params.toString()}`;
}
function replaceUrlWithState(
  router: ReturnType<typeof useRouter>, pathname: string,
  opts: { q: string; r: number; m: string; t: string[]; mode: Mode; dataSource: "none"|"csv"|"gsheet"; csvUrl: string; gsId: string; gsGid: string; gsSheet: string;
    askTrend:boolean; askChannels:boolean; askProvenance:boolean; askLOS:boolean; wxProvider:string; }
) {
  const url = makeShareUrl(pathname, opts);
  try { router.replace(url, { scroll: false }); } catch (e) {}
  try { if (typeof window !== "undefined") window.history.replaceState({}, "", url); } catch (e) {}
  return url;
}
function isWithinNextDays(d: Date, n = 7) {
  const today = new Date(); today.setHours(0,0,0,0);
  const max   = new Date(today); max.setDate(today.getDate() + n);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  return dd >= today && dd <= max;
}

/* ---------- Calendario Heatmap (con badge meteo) ---------- */
function CalendarHeatmap({
  monthDate,
  data
}:{monthDate: Date; data: {date: Date; pressure:number; adr:number; holidayName?: string; wx?: {t?:number; p?:number; code?: number}; eventCount?: number; events?: { title: string }[]}[]}) {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const days = eachDayOfInterval({start, end});
  const pvals = data.map(d=>d.pressure).filter(Number.isFinite);
  const pmin = Math.min(...(pvals.length? pvals : [0]));
  const pmax = Math.max(...(pvals.length? pvals : [1]));
  const firstDow = (getDay(start)+6)%7;
  const totalCells = firstDow + days.length;
  const rows = Math.ceil(totalCells/7);

  return (
    <div className="w-full">
      <div className="text-sm mb-1 grid grid-cols-7 gap-px text-center text-neutral-500">
        {WEEKDAYS.map((w,i)=> <div key={i} className="py-1 font-medium">{w}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-3">
        {Array.from({length: rows*7}).map((_,i)=>{
          const dayIndex = i - firstDow;
          const d = days[dayIndex];
          const dayData = d && data.find(x=> x.date.toDateString()===d.toDateString());
          if(dayIndex<0 || !d){ return <div key={i} className="h-24 bg-white border border-black/20 rounded-2xl"/>; }
          const isSat = ((getDay(d))===6);
          const pressure = dayData?.pressure ?? 0;
          const adr = dayData?.adr ?? 0;
          const fill = colorForPressure(pressure,pmin,pmax);
          const txtColor = contrastColor(fill);

          return (
            <div key={i} className="h-24 rounded-2xl border-2 border-black relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-1/2 bg-white px-2 flex items-center justify-between">
                <span className={`text-sm ${isSat?"text-red-600":"text-black"}`}>{format(d,"d",{locale:it})}</span>
                <span className={`text-xs ${isSat?"text-red-600":"text-neutral-600"}`}>{format(d,"EEE",{locale:it})}</span>
              </div>

              <div className="absolute inset-x-0 bottom-0 h-1/2 px-2 flex items-center justify-center" style={{background: fill}}>
                <span className="font-bold" style={{color: txtColor}}>€{adr}</span>
              </div>

              {dayData?.holidayName ? (
                <div className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-rose-500" title={dayData.holidayName}/>
              ) : null}

{(dayData?.eventCount ?? 0) > 0 && (
  <div
    className="absolute top-1 left-1"
    title={Array.isArray(dayData?.events) ? dayData.events.slice(0, 3).map(e => e.title).join(" · ") : "Evento"}
  >
    <span className="inline-block h-2 w-2 rounded-full bg-fuchsia-600" />
  </div>
)}

              {dayData?.wx?.t != null ? (
                <div className="absolute bottom-1 right-1 text-[10px] text-neutral-700/80">{dayData.wx.t.toFixed(0)}°C</div>
              ) : null}

              {dayData?.wx?.code != null && isWithinNextDays(d, 7) ? (
                <div className="absolute bottom-1 left-1" title="Previsione">
                  <WeatherIcon kind={codeToKind(dayData.wx.code)} className="h-[18px] w-[18px]" />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-center gap-4">
        <span className="text-xs">Bassa domanda</span>
        <div className="h-2 w-48 rounded-full" style={{background:"linear-gradient(90deg, rgb(255,255,204), rgb(227,26,28))"}}/>
        <span className="text-xs">Alta domanda</span>
      </div>
    </div>
  );
}

/* ---------- Multi-select Tipologie ---------- */
function TypesMultiSelect({
  value,
  onChange,
  allTypes,
  labels,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  allTypes: readonly string[];
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const toggle = (t: string) => {
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  };

  const summary =
    value.length === 0 ? "Nessuna" :
    value.length === allTypes.length ? "Tutte" :
    `${value.length} selezionate`;

  return (
    <div className="relative" ref={containerRef}>
      <span className="block text-sm font-medium text-neutral-700 mb-1">Tipologie</span>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-10 rounded-xl border border-neutral-300 bg-white px-3 text-left flex items-center justify-between hover:border-neutral-400 transition"
      >
        <span className="truncate">
          {summary}
          {value.length > 0 && value.length < allTypes.length ? (
            <span className="ml-2 text-xs text-neutral-500">
              {value.slice().sort().map((t) => labels[t] || t).slice(0, 2).join(", ")}
              {value.length > 2 ? "…" : ""}
            </span>
          ) : null}
        </span>
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full rounded-2xl border bg-white shadow-lg p-2">
          <ul className="space-y-1 max-h-64 overflow-auto pr-1">
            {allTypes.map((t) => {
              const active = value.includes(t);
              return (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => toggle(t)}
                    className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-slate-50" : "hover:bg-neutral-50"}`}
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
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg bg-white border px-2 py-1 text-xs">
      <div className="font-medium">{label}</div>
      <div>{(p.name ?? "Valore")}: <b>{p.value}</b></div>
    </div>
  );
}

export default function App(){
  const router = useRouter();
  const search = useSearchParams();

  // Notifiche / avvisi
  const [notices, setNotices] = useState<string[]>([]);

  // Filtri UI
  const [mode, setMode] = useState<Mode>("zone");
  const [query, setQuery] = useState("Firenze");
  const [radius, setRadius] = useState<number>(20);
  const [monthISO, setMonthISO] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
  });
  // Default: SOLO Hotel
  const [types, setTypes] = useState<string[]>(["hotel"]);

  // Meteo provider (client side) — di default Open-Meteo
  const [wxProvider, setWxProvider] = useState<"open-meteo"|"openweather">("open-meteo");
  const [shareUrl, setShareUrl] = useState<string>("");


  // Selettori SERP (uno per grafico)
  const [askTrend, setAskTrend] = useState(true);            // Andamento domanda
  const [askChannels, setAskChannels] = useState(false);     // Canali
  const [askProvenance, setAskProvenance] = useState(false); // Provenienza
  const [askLOS, setAskLOS] = useState(false);               // LOS

  // Dati esterni (CSV/GSheet)
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

// Pesi blend curva 12 mesi (default: SERP 60, Wiki 30, Stagionalità 10)
const [wSerpUser, setWSerpUser] = useState<number>(60);
const [wWikiUser, setWWikiUser] = useState<number>(30);
const [wSeaUser, setWSeaUser]   = useState<number>(10);
// Toggle pannello avanzato
const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

  // Festività + Meteo
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [weatherByDate, setWeatherByDate] = useState<Record<string, { t?: number; p?: number; code?: number }>>({});

// Eventi (ICS)
const [icsUrl, setIcsUrl] = useState<string>("");
type RawEv = { date: string; title: string; location?: string; lat?: number; lng?: number };
const [icsRaw, setIcsRaw] = useState<RawEv[]>([]);
const [eventsByDate, setEventsByDate] = useState<Record<string, { title: string }[]>>({});

  // Stato “applicato”
  const [aQuery, setAQuery] = useState(query);
  const [aRadius, setARadius] = useState(radius);
  const [aMonthISO, setAMonthISO] = useState(monthISO);
  const [aTypes, setATypes] = useState<string[]>(types);
  const [aMode, setAMode] = useState<Mode>(mode);
  const [aCenter, setACenter] = useState<{ lat: number; lng: number } | null>({ lat: 43.7696, lng: 11.2558 });

// Confronto array tipologie
const arraysEqual = (a?: string[] | null, b?: string[] | null) => {
  const aa = (a || []).slice().sort();
  const bb = (b || []).slice().sort();
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
};

// Flag: lo stato UI coincide con lo stato applicato?
const isApplied = useMemo(() => {
  return (
    query === aQuery &&
    radius === aRadius &&
    monthISO === aMonthISO &&
    arraysEqual(types, aTypes) &&
    mode === aMode
    // volendo, puoi aggiungere anche il centro mappa:
    // && ((aCenter && center) ? (aCenter.lat===center.lat && aCenter.lng===center.lng) : (!aCenter && !center))
  );
}, [query, aQuery, radius, aRadius, monthISO, aMonthISO, types, aTypes, mode, aMode]);

  // Contatore SerpAPI + polling
  const [serpUsage, setSerpUsage] = useState<{ used?: number; total?: number; left?: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const q = await fetch("/api/serp/quota").then(r => r.json());
        if (!alive) return;
        if (q?.ok) {
          setSerpUsage({
            used:  q.this_month_usage ?? q.raw?.this_month_usage,
            total: q.searches_per_month ?? q.raw?.searches_per_month,
            left:  q.plan_searches_left ?? q.raw?.plan_searches_left,
          });
        }
      } catch {}
    };
    pull();
    const id = setInterval(pull, 15 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Stato per grafici
  const [serpChannels, setSerpChannels] = useState<Array<{ channel: string; value: number }>>([]);
  const [serpOrigins, setSerpOrigins] = useState<Array<{ name: string; value: number }>>([]);
  const [serpLOS, setSerpLOS] = useState<Array<{ bucket: string; value: number }>>([]);
  const [serpTrend, setSerpTrend] = useState<Array<{ dateLabel: string; value: number }>>([]);

  // Flag cambi
  const hasChanges = useMemo(() =>
    aQuery !== query || aRadius !== radius || aMonthISO !== monthISO || aMode !== mode || aTypes.join(",") !== types.join(",") ||
    askTrend !== true || askChannels !== false || askProvenance !== false || askLOS !== false || wxProvider !== "open-meteo",
  [aQuery, query, aRadius, radius, aMonthISO, monthISO, aMode, mode, aTypes, types, askTrend, askChannels, askProvenance, askLOS, wxProvider]);

  // Normalizzazione
  const normalized: Normalized = useMemo(()=>{
    const warnings: string[] = [];
    const center = aCenter;
    const safeR = clampRadiusSilently(aRadius);
    const safeT = aTypes.length ? aTypes.filter(t=> (STRUCTURE_TYPES as readonly string[]).includes(t)) : ["hotel"];
    const safeMonthISO = safeParseMonthISO(aMonthISO, warnings);
    const safeDays = daysOfMonthWindow(safeMonthISO);
    return { warnings, safeMonthISO, safeDays, center: center ?? null, safeR, safeT, isBlocked: !center };
  }, [aMonthISO, aRadius, aTypes, aCenter]);

  // Avvisi
  useEffect(() => {
    setNotices(prev => (prev.join("|") === normalized.warnings.join("|") ? prev : normalized.warnings));
  }, [normalized.warnings]);

  // Leggi stato da URL al mount
  useEffect(() => {
    if (!search) return;
    const q = search.get("q") ?? "Firenze";
    const r = parseNumParam(search.get("r"), radius);
    const rawM = search.get("m");
    const m = rawM ? (rawM.length === 7 ? `${rawM}-01` : rawM) : monthISO;
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
    setDataSource(src); setCsvUrl(csv); setGsId(id); setGsGid(gid ?? ""); setGsSheet(sheet ?? "");
    setAskTrend(trendQ==null ? true : trendQ==="1");
    setAskChannels(chQ==="1"); setAskProvenance(prQ==="1"); setAskLOS(losQ==="1");
    setWxProvider(wx);

    setAQuery(q); setARadius(r); setAMonthISO(m); setATypes(t); setAMode(modeParam);
    setACenter({ lat: 43.7696, lng: 11.2558 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- Geocoding ----- */
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
        replaceUrlWithState(router, (typeof window !== "undefined" ? location.pathname : "/"),
          { q: name, r: radius, m: monthISO, t: types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet, askTrend, askChannels, askProvenance, askLOS, wxProvider });
      } else { alert("Località non trovata"); }
    } catch (e) { alert("Errore di geocoding"); }
  }, [query, radius, monthISO, types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet, askTrend, askChannels, askProvenance, askLOS, wxProvider, router]);

  /* ----- Reverse geocoding (click mappa) ----- */
  const onMapClick = useCallback(async ({ lat, lng }: { lat: number; lng: number }) => {
    let name = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try { const r = await fetch(`/api/external/reverse-geocode?lat=${lat}&lng=${lng}`); const j = r.ok ? await r.json() : null; if (j) name = String(j?.name ?? j?.display_name ?? name); } catch (e) {}
    setQuery(name);
    setACenter({ lat, lng }); setAQuery(name);
    setARadius(radius); setAMonthISO(monthISO); setATypes(types); setAMode(mode);
    replaceUrlWithState(router, (typeof window !== "undefined" ? location.pathname : "/"),
      { q: name, r: radius, m: monthISO, t: types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet, askTrend, askChannels, askProvenance, askLOS, wxProvider });
  }, [radius, monthISO, types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet, askTrend, askChannels, askProvenance, askLOS, wxProvider, router]);
  /* ----- Festività IT ----- */
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

  /* ----- Meteo ----- */
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

/* ----- Eventi (ICS) ----- */
useEffect(() => {
  if (!icsUrl) { setIcsRaw([]); setEventsByDate({}); return; }
  const u = `/api/events/ics?url=${encodeURIComponent(icsUrl)}`;
  let alive = true;
  (async () => {
    try {
      const r = await http.json<any>(u, { timeoutMs: 8000, retries: 1 });
      if (!alive) return;
      if (r.ok && Array.isArray(r.data?.events)) {
        setIcsRaw(r.data.events as RawEv[]);
      } else {
        setIcsRaw([]);
        setEventsByDate({});
        setNotices(prev => Array.from(new Set([...prev, "ICS non disponibile o vuoto."])));
      }
    } catch {
      setIcsRaw([]);
      setEventsByDate({});
    }
  })();
  return () => { alive = false; };
}, [icsUrl]);

// Geo-filter: geocodifica LOCATION quando mancano le coordinate e filtra entro raggio
useEffect(() => {
  let alive = true;
  (async () => {
    try {
      // Se non c'è centro selezionato, mostra TUTTI gli eventi del mese
      const center = aCenter ? { lat: aCenter.lat, lng: aCenter.lng } : null;
      const radiusKm = aRadius ?? 0;

      // Cache locale per location->coords
      const cache = new Map<string, { lat: number; lng: number }>();
      const uniqLocs: string[] = [];

      // Prepara array con coords (riempi da GEO o da geocoding LOCATION)
      const withCoords: RawEv[] = [];
      for (const ev of icsRaw) {
        if (ev.lat != null && ev.lng != null) {
          withCoords.push(ev);
        } else if (ev.location && ev.location.trim()) {
          const key = ev.location.trim();
          if (!cache.has(key)) uniqLocs.push(key);
          withCoords.push(ev);
        } else {
          // Niente coords e niente location: lo teniamo ma non filtrabile
          withCoords.push(ev);
        }
      }

      // Geocoding (best-effort) per al massimo 10 location uniche
      for (const loc of uniqLocs.slice(0, 10)) {
        try {
          const url = `/api/external/geocode?q=${encodeURIComponent(loc)}`;
          const gr = await http.json<any>(url, { timeoutMs: 7000, retries: 1 });
          if (gr.ok) {
            // accetta vari formati possibili
            let lat: number | undefined;
            let lng: number | undefined;
            const j = gr.data;
            if (Array.isArray(j?.results) && j.results[0]) {
              lat = Number(j.results[0].lat ?? j.results[0].latitude);
              lng = Number(j.results[0].lng ?? j.results[0].lon ?? j.results[0].longitude);
            } else if (j?.lat != null && j?.lon != null) {
              lat = Number(j.lat); lng = Number(j.lon);
            }
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              cache.set(loc, { lat: lat!, lng: lng! });
            }
          }
        } catch {}
      }

      // Filtra per raggio (se center presente); altrimenti non filtrare
const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const toRad = (x: number) => x * Math.PI / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

      const map: Record<string, { title: string }[]> = {};
      for (const ev of withCoords) {
        // coords note?
        let elat = ev.lat, elng = ev.lng;
        if ((elat == null || elng == null) && ev.location && cache.has(ev.location.trim())) {
          const c = cache.get(ev.location.trim())!;
          elat = c.lat; elng = c.lng;
        }

        let include = true;
        if (center && Number.isFinite(elat as number) && Number.isFinite(elng as number)) {
          include = haversineKm(center.lat, center.lng, elat!, elng!) <= radiusKm;
        } // se manca center/coords → include rimane true

        if (include) {
          if (!map[ev.date]) map[ev.date] = [];
          map[ev.date].push({ title: ev.title });
        }
      }

      if (alive) setEventsByDate(map);
    } catch {
      if (alive) setEventsByDate({});
    }
  })();
  return () => { alive = false; };
}, [icsRaw, aRadius, aCenter?.lat, aCenter?.lng]);

  /* ----- SERPAPI: linea + segmenti + quota ----- */
  const fetchSerp = useCallback(async () => {
    if (!aCenter) return;

    const needTrend = askTrend === true;
    const needRelated = !!(askChannels || askProvenance || askLOS);
    if (!needTrend && !needRelated) return;

    try {
      const parts: string[] = [];
      if (needTrend) parts.push("trend");
      if (needRelated) parts.push("related");

      const params = new URLSearchParams({
        q: aQuery || "",
        lat: String(aCenter.lat),
        lng: String(aCenter.lng),
        date: "today 12-m",
        cat: "203",
        parts: parts.join(","),
        ch: askChannels ? "1" : "0",
        prov: askProvenance ? "1" : "0",
        los: askLOS ? "1" : "0",
      });

      const r1 = await http.json<any>(`/api/serp/demand?${params.toString()}`, { timeoutMs: 8000, retries: 2 });
      const j = r1.ok ? r1.data : null;

     if (!j || j.ok !== true) {
  // Avviso
  setNotices(prev =>
    Array.from(new Set([
      ...prev,
      (j && (j as any).error) ? String((j as any).error) : "Nessun dato SERP per la query/periodo: uso curva di stagionalità."
    ]))
  );

  // Fallback: stagionalità Italia su 12 mesi (sempre visibile)
  const labels = last12LabelsLLLyy();        // es. ["nov 24", ..., "ott 25"]
  const seas   = normalizeTo100(seasonalityItaly12()); // array di 12 valori
  setSerpTrend(labels.map((lbl, i) => ({ dateLabel: lbl, value: seas[i] || 0 })));

  // Related non disponibili
  setSerpChannels([]);
  setSerpOrigins([]);
  setSerpLOS([]);

  // NON interrompere tutta la funzione se vuoi far proseguire ad altre routine;
  // qui però va bene chiudere perché non abbiamo altri step necessari.
  return;
}

      // --- Trend (ultimi 12 mesi): BLEND SERP + WIKIPEDIA + STAGIONALITÀ ---
let finalTrend: Array<{ dateLabel: string; value: number }> = [];
const monthLabels = last12LabelsLLLyy(); // ["ott 24", ..., "set 25"]

// 1) Serie SERP normalizzata su 12 bucket (se disponibile)
let serp12: number[] = new Array(12).fill(0);
if (needTrend && Array.isArray(j.series)) {
  // Raggruppa per mese (label LLL yy), media valori
  const byMonth: Record<string, { sum: number; n: number }> = {};
  (j.series as any[]).forEach((s: any) => {
    try {
      const dStr = typeof s.date === "string" ? s.date : String(s.date);
      const lbl = format(parseISO(dStr), "LLL yy", { locale: it });
      if (!byMonth[lbl]) byMonth[lbl] = { sum: 0, n: 0 };
      byMonth[lbl].sum += Number(s.score) || 0;
      byMonth[lbl].n  += 1;
    } catch {}
  });
  serp12 = monthLabels.map(lbl => {
    const cell = byMonth[lbl];
    const v = cell ? (cell.sum / Math.max(1, cell.n)) : 0;
    return Number.isFinite(v) ? v : 0;
  });
  serp12 = normalizeTo100(serp12);
} else {
  serp12 = new Array(12).fill(0);
}

// 2) Serie Wikipedia (IT+EN) normalizzata (se disponibile)
const city = cityFromTopic(aQuery || "");
let wiki12: number[] = new Array(12).fill(0);
try {
  const w = await http.json<any>(`/api/baseline/wiki?q=${encodeURIComponent(city)}&months=12`, { timeoutMs: 7000, retries: 1 });
  if (w.ok && Array.isArray(w.data?.series)) {
    const series = w.data.series as Array<{ month: string; views: number }>;
    // Map su label LLL yy
    const map: Record<string, number> = {};
    series.forEach(row => {
      const [y, m] = row.month.split("-");
      const lbl = format(new Date(Number(y), Number(m)-1, 1), "LLL yy", { locale: it });
      map[lbl] = (map[lbl] || 0) + (Number(row.views) || 0);
    });
    wiki12 = monthLabels.map(lbl => map[lbl] || 0);
    wiki12 = normalizeTo100(wiki12);
  }
} catch { /* ignore */ }

// 3) Stagionalità Italia
const seas12 = normalizeTo100(seasonalityItaly12());

// 4) Blend con pesi utente (0–100) vincolati alla disponibilità dei segnali
let wSerp = (wSerpUser / 100);
let wWiki = (wWikiUser / 100);
let wSea  = (wSeaUser  / 100);

// Se un segnale non è disponibile, mette il suo peso a 0
if (!serp12.some(v => v > 0)) wSerp = 0;
if (!wiki12.some(v => v > 0)) wWiki = 0;

// Rinormalizza per sommare a 1 (se tutti 0 → tutto alla stagionalità)
let sum = wSerp + wWiki + wSea;
if (sum <= 0) { wSerp = 0; wWiki = 0; wSea = 1; sum = 1; }
wSerp /= sum; wWiki /= sum; wSea /= sum;

const mixed = blend3(serp12, wiki12, seas12, wSerp, wWiki, wSea);
const mixedN = normalizeTo100(mixed);

// 5) Adatta all’array per Recharts
finalTrend = monthLabels.map((lbl, i) => ({ dateLabel: lbl, value: mixedN[i] || 0 }));
const partsUsed: string[] = [];
if (wSerp > 0) partsUsed.push("SERP");
if (wWiki > 0) partsUsed.push("Wikipedia");
if (wSea  > 0) partsUsed.push("Stagionalità");
if (partsUsed.length > 0 && partsUsed.join("+") !== "SERP") {
  setNotices(prev => Array.from(new Set([...prev, `Curva composta: ${partsUsed.join(" + ")}`])));
}
setSerpTrend(finalTrend);

      // --- Related (canali / provenienza / los) ---
      if (needRelated) {
        const rel = j.related || { channels: [], provenance: [], los: [] };

        const ch = (Array.isArray(rel.channels) ? rel.channels : []).map((x: any) => ({
          channel: String(x.label || "").replace(/^\w/, (m: string) => m.toUpperCase()),
          value: Number(x.value) || 0,
        }));

        const or = (Array.isArray(rel.provenance) ? rel.provenance : []).map((x: any) => ({
          name: String(x.label || "").replace(/^\w/, (m: string) => m.toUpperCase()),
          value: Number(x.value) || 0,
        }));

        const lo = (Array.isArray(rel.los) ? rel.los : []).map((x: any) => ({
          bucket: String(x.label || ""),
          value: Number(x.value) || 0,
        }));

        setSerpChannels(ch);
        setSerpOrigins(or);
        setSerpLOS(lo);
      } else {
        setSerpChannels([]);
        setSerpOrigins([]);
        setSerpLOS([]);
      }

      // --- Badge quota (best-effort, ignora errori) ---
      try {
        const r2 = await http.json<any>("/api/serp/quota", { timeoutMs: 6000, retries: 1 });
        const q = r2.ok ? r2.data : null;
        if (q && q.ok) {
          const badge = {
            used:  (j.usage && j.usage.this_month_usage) ?? q.this_month_usage ?? undefined,
            total: (j.usage && j.usage.searches_per_month) ?? q.searches_per_month ?? undefined,
            left:  (j.usage && j.usage.plan_searches_left) ?? q.plan_searches_left ?? undefined,
          };
          setSerpUsage(badge);
        }
      } catch (e) {
        // ignore
      }
    } catch (e) {
      setNotices(prev =>
        Array.from(new Set([...prev, "Errore richiesta SERP: uso dati dimostrativi."]))
      );
    }
  }, [aQuery, aCenter, aMonthISO, askTrend, askChannels, askProvenance, askLOS]);

  useEffect(() => { fetchSerp(); }, [fetchSerp]);
// Link per la pagina "Grafica": se tutti i toggle sono OFF, forziamo ch/prov/los a ON
const graficaHref = useMemo(() => {
  const p = new URLSearchParams();
  if (aQuery) p.set("q", aQuery);
  if (typeof aRadius === "number") p.set("r", String(aRadius));
  if (aMonthISO) p.set("m", aMonthISO.slice(0, 7));
  if (Array.isArray(aTypes) && aTypes.length) p.set("t", aTypes.join(","));
  if (aMode) p.set("mode", aMode);
  if (wxProvider) p.set("wx", wxProvider);
  if (askTrend) p.set("trend", "1");

  const noneSelected = !askChannels && !askProvenance && !askLOS;
  p.set("ch",   (askChannels   || noneSelected) ? "1" : "0");
  p.set("prov", (askProvenance || noneSelected) ? "1" : "0");
  p.set("los",  (askLOS        || noneSelected) ? "1" : "0");

  const qs = p.toString();
  return "/grafica" + (qs ? `?${qs}` : "");
}, [aQuery, aRadius, aMonthISO, aTypes, aMode, wxProvider, askTrend, askChannels, askProvenance, askLOS]);

const monthDate = useMemo(() => {
  if (!aMonthISO) return new Date();
  try { return parseISO(aMonthISO); } catch (e) { return new Date(); }
}, [aMonthISO]);

// Preferenze: ripristino al mount se non c'è query string
useEffect(() => {
  if (typeof window === "undefined") return;
  if (window.location.search && window.location.search.length > 1) return;

  try {
    const raw = localStorage.getItem("widget:last");
    if (!raw) return;
    const saved = JSON.parse(raw);

    // Applica ai campi UI (non direttamente agli "applied")
    if (saved.q) setQuery(saved.q);
    if (typeof saved.r === "number") setRadius(saved.r);
    if (saved.m) setMonthISO(saved.m);
    if (Array.isArray(saved.t)) setTypes(saved.t);
    if (saved.mode) setMode(saved.mode);
    if (saved.wx) setWxProvider(saved.wx);
    if (typeof saved.trend === "boolean") setAskTrend(saved.trend);
    if (typeof saved.ch === "boolean") setAskChannels(saved.ch);
    if (typeof saved.prov === "boolean") setAskProvenance(saved.prov);
    if (typeof saved.los === "boolean") setAskLOS(saved.los);
if (typeof saved.wSerpUser === "number") setWSerpUser(saved.wSerpUser);
if (typeof saved.wWikiUser === "number") setWWikiUser(saved.wWikiUser);
if (typeof saved.wSeaUser  === "number") setWSeaUser(saved.wSeaUser);
  } catch {}
}, []);

// Preferenze: salvataggio dell'ultima configurazione applicata
useEffect(() => {
  if (typeof window === "undefined") return;
  const payload = {
  q: aQuery, r: aRadius, m: aMonthISO, t: aTypes, mode: aMode,
  wx: wxProvider, trend: askTrend, ch: askChannels, prov: askProvenance, los: askLOS,
  wSerpUser, wWikiUser, wSeaUser
};
  try { localStorage.setItem("widget:last", JSON.stringify(payload)); } catch {}
}, [aQuery, aRadius, aMonthISO, aTypes, aMode, wxProvider, askTrend, askChannels, askProvenance, askLOS]);

    // Calendario (pressione + adr dimostrativi)
  const calendarData = useMemo(() => {
    const days = daysOfMonthWindow(aMonthISO);
    return days.map(d => {
  const k = format(d, "yyyy-MM-dd");
  return {
    date: d,
    pressure: pressureFor(d),
    adr: adrFromCompetitors(d, aMode),
    holidayName: holidays[k],
    wx: weatherByDate[k] || undefined,
    eventCount: (eventsByDate[k]?.length || 0),
    events: eventsByDate[k],
  };
});
  }, [aMonthISO, aMode, holidays, weatherByDate, eventsByDate]);

  const provenance = useMemo(() => (serpOrigins.length > 0 ? serpOrigins : []), [serpOrigins]);
  const los = useMemo(() => (serpLOS.length > 0 ? serpLOS : []), [serpLOS]);
  const channels = useMemo(() => (serpChannels.length > 0 ? serpChannels : []), [serpChannels]);

  const meteoCovered = useMemo(
    () => calendarData.filter((d: any) => d?.wx?.code != null && isWithinNextDays(d.date, 7)).length,
    [calendarData]
  );

  const handleReset = useCallback(() => {
    const now = new Date();
    const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
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

  return (
  <div className="min-h-screen bg-slate-50">
    {/* Topbar */}
    <div className="sticky top-0 z-[1100] border-b bg-white backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Widget Hospitality Analytics</h1>

          {(serpUsage?.used != null || serpUsage?.left != null || serpUsage?.total != null) && (
            <span
              className="inline-flex items-center gap-2 text-xs px-2 py-1 rounded-full border bg-white"
              title="Stato SerpAPI"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  serpUsage?.left == null ? "bg-slate-400" :
                  serpUsage.left === 0 ? "bg-rose-500" : "bg-emerald-500"
                }`}
                title={serpUsage?.left == null ? "Stato sconosciuto" : (serpUsage.left === 0 ? "Quota esaurita" : "Connesso")}
              />
              <span>Connesso a SerpAPI</span>
              <span className="opacity-60">·</span>
              <span>SERP {serpUsage?.used ?? "?"}/{serpUsage?.total ?? "?"} (rimasti {serpUsage?.left ?? "?"})</span>
            </span>
          )}
        </div>

        <button
          className="px-3 py-2 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-800"
          onClick={handleReset}
          title="Reset"
        >
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Reset
          </span>
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

{/* Eventi (ICS) */}
<section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
  <div className="text-sm font-semibold">Eventi locali (ICS)</div>
  <div className="flex items-center gap-2">
    <label className="w-28 text-sm text-slate-700">ICS URL</label>
    <input
      className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm"
      value={icsUrl}
      onChange={(e) => setIcsUrl(e.target.value)}
      placeholder="https://…/calendar.ics"
    />
  </div>
  <div className="text-xs text-slate-600">
    Se fornito, i giorni con evento mostrano un puntino viola (hover per il titolo).
  </div>
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

{/* Avanzate: pesi blend curva 12 mesi */}
<div className="mt-2">
  <button
    type="button"
    className="text-xs underline text-slate-600"
    onClick={() => setAdvancedOpen(v => !v)}
  >
    {advancedOpen ? "Nascondi" : "Mostra"} opzioni avanzate (pesi curva 12 mesi)
  </button>

  {advancedOpen && (
    <div className="mt-2 space-y-2 border rounded-xl p-3 bg-slate-50">
      <div className="text-[11px] text-slate-600">
        I pesi si adattano automaticamente se un segnale non è disponibile (es. SERP a zero).
      </div>
      <div className="grid grid-cols-1 gap-2">
        <label className="text-xs flex items-center gap-2">
          <span className="w-32">SERP</span>
          <input type="range" min={0} max={100} value={wSerpUser}
            onChange={(e) => setWSerpUser(parseInt(e.currentTarget.value))}
            className="flex-1" />
          <span className="w-10 text-right">{wSerpUser}%</span>
        </label>
        <label className="text-xs flex items-center gap-2">
          <span className="w-32">Wikipedia</span>
          <input type="range" min={0} max={100} value={wWikiUser}
            onChange={(e) => setWWikiUser(parseInt(e.currentTarget.value))}
            className="flex-1" />
          <span className="w-10 text-right">{wWikiUser}%</span>
        </label>
        <label className="text-xs flex items-center gap-2">
          <span className="w-32">Stagionalità</span>
          <input type="range" min={0} max={100} value={wSeaUser}
            onChange={(e) => setWSeaUser(parseInt(e.currentTarget.value))}
            className="flex-1" />
          <span className="w-10 text-right">{wSeaUser}%</span>
        </label>
      </div>
      <div className="text-[11px] text-slate-600">
        Nota: i tre valori vengono normalizzati e sommati a 100% in base ai segnali realmente disponibili.
      </div>
    </div>
  )}
</div>
              <div>
               <button
  className={
    "w-full inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border text-white " +
    (isApplied
      ? "bg-emerald-600 hover:bg-emerald-600 cursor-default"
      : "bg-slate-900 hover:bg-slate-800")
  }
  title={isApplied ? "Filtri applicati" : "Applica i filtri"}
  onClick={() => {
    if (isApplied) return; // già allineato, non rifacciamo nulla

    const next = {
      q: query, r: radius, m: monthISO, t: types, mode,
      dataSource, csvUrl, gsId, gsGid, gsSheet,
      askTrend, askChannels, askProvenance, askLOS, wxProvider
    };

    // porta lo stato “applicato” = UI attuale
    setAQuery(next.q);
    setARadius(next.r);
    setAMonthISO(next.m);
    setATypes(next.t);
    setAMode(next.mode);
    if (!aCenter) setACenter({ lat: 43.7696, lng: 11.2558 });

    // URL e share
    replaceUrlWithState(
      router,
      (typeof window !== "undefined" ? location.pathname : "/"),
      next
    );
    const share = makeShareUrl(
      (typeof window !== "undefined" ? location.pathname : "/"),
      next
    );
    setShareUrl(share);

    // trigger fetch SERP (se quota disponibile)
    fetchSerp();
  }}
>
  <RefreshCw className="h-4 w-4 mr-2" />
  {isApplied ? "Analisi applicata" : "Genera Analisi"}
</button>

<div className="mt-2">
  <a
    href={graficaHref}
    className="w-full inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border bg-white hover:bg-slate-50"
  >
    Area Grafica
  </a>
</div>

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
                center={aCenter ? { lat: aCenter.lat, lng: aCenter.lng } : null}
                radius={aRadius * 1000}
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
                  <RTooltip content={<CustomTooltip />} />
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
