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
  series?: Array<{ date: string; score: number }>; // per linea
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
// accettiamo 10/20/30 ma **non** mostriamo avviso se diverso (clamp silenzioso)
const RADIUS_OPTIONS = [10,20,30] as const;

const typeLabels: Record<string,string> = {
  hotel:"Hotel", agriturismo:"Agriturismo", casa_vacanza:"Case Vacanza",
  villaggio_turistico:"Villaggi Turistici", resort:"Resort", "b&b":"B&B", affittacamere:"Affittacamere"
};

const THEME = {
  chart: {
    pie: { innerRadius: 60, outerRadius: 110, paddingAngle: 4, cornerRadius: 8 },
    bar: { margin: { top: 8, right: 16, left: 0, bottom: 0 }, tickSize: 12 },
    barWide: { margin: { top: 8, right: 16, left: 0, bottom: 30 }, tickSize: 12 },
    line: { stroke: "#1e3a8a", strokeWidth: 2, dotRadius: 2 },
  },
  palette: {
    barBlue: ["#93c5fd","#60a5fa","#3b82f6","#1d4ed8"],
    barOrange: ["#fdba74","#fb923c","#f97316","#ea580c","#c2410c"],
    solid: ["#ef4444","#f59e0b","#10b981","#3b82f6","#8b5cf6","#22c55e","#eab308","#06b6d4"]
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
  try { router.replace(url, { scroll: false }); } catch {}
  try { if (typeof window !== "undefined") window.history.replaceState({}, "", url); } catch {}
  return url;
}
function isWithinNextDays(d: Date, n = 7) {
  const today = new Date(); today.setHours(0,0,0,0);
  const max   = new Date(today); max.setDate(today.getDate() + n);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  return dd >= today && dd <= max;
}
function resampleToDays(series: {date:string; score:number}[], monthISO: string) {
  const monthDays = daysOfMonthWindow(monthISO);
  if (!series?.length) return monthDays.map(d => ({ dateLabel: format(d,"d MMM",{locale:it}), value: 0 }));
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

/* ---------- Calendario Heatmap (con badge meteo) ---------- */
function CalendarHeatmap({
  monthDate,
  data
}:{monthDate: Date; data: {date: Date; pressure:number; adr:number; holidayName?: string; wx?: {t?:number; p?:number; code?: number}}[]}){
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
// ===== Block 2/4 =====
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

  // Selettori SERP (uno per grafico)
  const [askTrend, setAskTrend] = useState(true);            // Andamento domanda
  const [askChannels, setAskChannels] = useState(false);     // Canali
  const [askProvenance, setAskProvenance] = useState(false); // Provenienza
  const [askLOS, setAskLOS] = useState(false);               // LOS

  // Dati esterni già presenti nel tuo widget
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

  // Contatore SerpAPI
  const [serpUsage, setSerpUsage] = useState<{ used?: number; total?: number; left?: number } | null>(null);

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
    } catch { alert("Errore di geocoding"); }
  }, [query, radius, monthISO, types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet, askTrend, askChannels, askProvenance, askLOS, wxProvider, router]);

  /* ----- Reverse geocoding (click mappa) ----- */
  const onMapClick = useCallback(async ({ lat, lng }: { lat: number; lng: number }) => {
    let name = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try { const r = await fetch(`/api/external/reverse-geocode?lat=${lat}&lng=${lng}`); const j = r.ok ? await r.json() : null; if (j) name = String(j?.name ?? j?.display_name ?? name); } catch {}
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

  /* ----- SERPAPI: linea + segmenti + quota ----- */
  const fetchSerp = useCallback(async () => {
    if (!aCenter) return;

    const needTrend   = askTrend;
    const needRelated = askChannels || askProvenance || askLOS;
    if (!needTrend && !needRelated) return;

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
      // comunica al backend quali bucket "related" servono
      params.set("ch", String(+askChannels));
      params.set("prov", String(+askProvenance));
      params.set("los", String(+askLOS));

      const r = await fetch(`/api/serp/demand?${params.toString()}`);
      const j: SerpDemandPayload = await r.json();

      if (!j?.ok) {
        setNotices(prev => Array.from(new Set([...prev, (j as any)?.error || "Errore richiesta SERP: uso dati dimostrativi."])));
        return;
      }

      // Quota SERP (parziale dalla stessa response)
      let badge = {
        used: j.usage?.this_month_usage,
        total: j.usage?.searches_per_month,
        left: j.usage?.plan_searches_left
      } as any;

     if (needTrend && Array.isArray(j.series)) {
  // Usa l’intera serie “today 12-m” (tipicamente settimanale)
  const points = j.series.map(s => ({
    dateLabel: format(parseISO(s.date), "LLL yy", { locale: it }),
    value: Number(s.score) || 0,
  }));
  setSerpTrend(points);
} else if (!needTrend) {
  setSerpTrend([]);
}

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

      // Merge badge con /api/serp/quota
      try {
        const q = await fetch("/api/serp/quota").then(r=>r.json());
        if (q?.ok) {
          badge.used  = badge.used  ?? q.this_month_usage;
          badge.total = badge.total ?? q.searches_per_month ?? q.raw?.searches_per_month;
          badge.left  = badge.left  ?? q.plan_searches_left ?? q.raw?.plan_searches_left;
        }
      } catch {}
      setSerpUsage(badge);

    } catch {
      setNotices(prev => Array.from(new Set([...prev, "Errore richiesta SERP: uso dati dimostrativi."])));
    }
  }, [aQuery, aCenter, aMonthISO, askTrend, askChannels, askProvenance, askLOS]);

  useEffect(() => { fetchSerp(); }, [fetchSerp]);
// ===== Block 3/4 =====
  // CSV/GS (ridotto)
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

  const monthDate = useMemo(()=> {
    if(!aMonthISO) return new Date();
    try { return parseISO(aMonthISO); } catch { return new Date(); }
  }, [aMonthISO]);

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

  const provenance = useMemo(()=> (serpOrigins.length>0 ? serpOrigins : []), [serpOrigins]);
  const los = useMemo(()=> (serpLOS.length>0 ? serpLOS : []), [serpLOS]);
  const channels = useMemo(()=> (serpChannels.length>0 ? serpChannels : []), [serpChannels]);

  const meteoCovered = useMemo(
    () => calendarData.filter((d: any) => d?.wx?.code != null && isWithinNextDays(d.date, 7)).length,
    [calendarData]
  );

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

  const [shareUrl, setShareUrl] = useState<string>("");
// HREF per pagina Grafica: usa il path corrente + query del link condivisibile
const graficaHref = useMemo(() => {
  const base = (typeof window !== "undefined" ? location.pathname : "/");
  const qs = shareUrl.includes("?") ? shareUrl.slice(shareUrl.indexOf("?")) : "";
  return base.replace(/\/$/, "") + "/grafica" + qs;
}, [shareUrl]);

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
            <span className="inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/> Reset</span>
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
              <select className="h-9 rounded-xl border border-slate-300 px-2 text-sm w-full" value={dataSource} onChange={(e)=> setDataSource(e.target.value as any)}>
                <option value="none">Nessuna (demo)</option>
                <option value="csv">CSV URL</option>
                <option value="gsheet">Google Sheet</option>
              </select>
            </div>
            {dataSource === "csv" && (
              <div className="flex items-center gap-2">
                <label className="w-28 text-sm text-slate-700">CSV URL</label>
                <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm" value={csvUrl} onChange={e=> setCsvUrl(e.target.value)} placeholder="https://.../out:csv&sheet=Foglio1" />
              </div>
            )}
            {dataSource === "gsheet" && (
              <>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Sheet ID</label>
                  <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm" value={gsId} onChange={e=> setGsId(e.target.value)} placeholder="1AbC…" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Nome foglio</label>
                  <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm" value={gsSheet} onChange={e=> setGsSheet(e.target.value)} placeholder="Foglio1 / Sheet1" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Sheet GID</label>
                  <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm" value={gsGid} onChange={e=> setGsGid(e.target.value)} placeholder="es. 0 (#gid=...)" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-28 text-sm text-slate-700">Modalità</label>
                  <div className="flex items-center gap-2">
                    <input id="strict" type="checkbox" checked={strictSheet} onChange={(e)=> setStrictSheet(e.currentTarget.checked)} />
                    <label htmlFor="strict" className="text-sm">Rigida (consigliata)</label>
                  </div>
                </div>
              </>
            )}
            {loading && <div className="text-xs text-slate-600">Caricamento dati…</div>}
            {loadError && <div className="text-xs text-rose-600">Errore sorgente: {loadError}</div>}
            {rawRows.length>0 && <div className="text-xs text-emerald-700">Dati caricati: {rawRows.length} righe</div>}
          </section>

          {/* Località / Raggio / Mese / Tipologie / Meteo provider */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-slate-700"/>
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
              <Route className="h-5 w-5 text-slate-700"/>
              <label className="w-28 text-sm text-slate-700">Raggio</label>
              <select className="h-9 rounded-xl border border-slate-300 px-2 text-sm w-40" value={String(radius)} onChange={(e)=> setRadius(parseInt(e.target.value))}>
                {RADIUS_OPTIONS.map(r=> <option key={r} value={r}>{r} km</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-slate-700"/>
              <label className="w-28 text-sm text-slate-700">Mese</label>
              <input type="month" value={monthISO ? monthISO.slice(0,7) : ""} onChange={e=> setMonthISO(`${e.target.value||""}-01`)} className="w-48 h-9 rounded-xl border border-slate-300 px-2 text-sm"/>
            </div>

            <div className="flex items-center gap-2">
              <label className="w-28 text-sm text-slate-700">Meteo</label>
              <select className="h-9 rounded-xl border border-slate-300 px-2 text-sm w-48" value={wxProvider} onChange={(e)=> setWxProvider(e.target.value as any)}>
                <option value="open-meteo">Open-Meteo (default)</option>
                <option value="openweather">OpenWeather (se configurato)</option>
              </select>
            </div>

            <TypesMultiSelect value={types} onChange={setTypes} allTypes={STRUCTURE_TYPES} labels={typeLabels} />

            {/* Selettori SERP */}
            <div className="rounded-xl border bg-white p-3">
              <div className="text-sm font-semibold mb-2">Dati da chiedere alle API</div>
              <label className="flex items-center gap-2 text-sm mb-1">
                <input type="checkbox" checked={askTrend} onChange={(e)=> setAskTrend(e.currentTarget.checked)} />
                <span>Andamento domanda (Google Trends)</span>
              </label>
              <label className="flex items-center gap-2 text-sm mb-1">
                <input type="checkbox" checked={askChannels} onChange={(e)=> setAskChannels(e.currentTarget.checked)} />
                <span>Canali di vendita</span>
              </label>
              <label className="flex items-center gap-2 text-sm mb-1">
                <input type="checkbox" checked={askProvenance} onChange={(e)=> setAskProvenance(e.currentTarget.checked)} />
                <span>Provenienza clienti</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={askLOS} onChange={(e)=> setAskLOS(e.currentTarget.checked)} />
                <span>Durata media soggiorno (LOS)</span>
              </label>
              <p className="mt-2 text-[11px] text-slate-500">
                Spunta solo i grafici che ti servono: risparmi query su SerpAPI.
              </p>
            </div>

            {/* Modalità + Pulsante + Link condivisibile */}
            <div className="grid grid-cols-1 gap-3 mt-2">
              <div className="flex items-center gap-3">
                <label className="w-28 text-sm text-slate-700">Modalità</label>
                <div className="inline-flex rounded-xl border overflow-hidden">
                  <button
                    title="Analizza la domanda “macro” dell’area selezionata (es. “Firenze hotel”). Curva di interesse locale e ADR neutro."
                    className={`px-3 py-1 text-sm ${mode==="zone"?"bg-slate-900 text-white":"bg-white text-slate-900"}`}
                    onClick={()=> setMode("zone")}
                  >
                    Zona
                  </button>
                  <button
                    title="Vista competitor: stessa curva di domanda (fonte Trends free), ma ADR stimato più aggressivo per contesto competitivo."
                    className={`px-3 py-1 text-sm ${mode==="competitor"?"bg-slate-900 text-white":"bg-white text-slate-900"}`}
                    onClick={()=> setMode("competitor")}
                  >
                    Competitor
                  </button>
                </div>
              </div>

              <div>
                <button
                  className="w-full inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border bg-slate-900 text-white border-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    const next = { q: query, r: radius, m: monthISO, t: types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet,
                      askTrend, askChannels, askProvenance, askLOS, wxProvider };
                    setAQuery(next.q); setARadius(next.r); setAMonthISO(next.m); setATypes(next.t); setAMode(next.mode);
                    if (!aCenter) setACenter({ lat: 43.7696, lng: 11.2558 });
                    const url = replaceUrlWithState(router, (typeof window !== "undefined" ? location.pathname : "/"), next);
                    setShareUrl(url);
                    fetchSerp();
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2"/>
                  Genera Analisi
                </button>
<div className="mt-2">
  <a
    href={graficaHref}
    className="w-full inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border bg-white hover:bg-slate-50"
  >
    Apri pagina Grafica
  </a>
</div>

                {shareUrl && (
                  <div className="mt-2">
                    <label className="block text-xs text-slate-600 mb-1">Link condivisibile</label>
                    <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-xs" value={typeof window !== "undefined" ? `${location.origin}${shareUrl}` : shareUrl} readOnly onFocus={(e)=> e.currentTarget.select()} />
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Avvisi */}
          {notices.length>0 && (
            <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="text-sm font-semibold text-amber-900">Avvisi</div>
              <ul className="list-disc ml-5 text-sm text-amber-900">{notices.map((n,i)=> <li key={i}>{n}</li>)}</ul>
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
         
          {/* Andamento Domanda */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Andamento Domanda – Ultimi 12 mesi</div>

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
                  <XAxis dataKey="dateLabel" tick={{fontSize: 12}} interval={3}/>
                  <YAxis />
                  <RTooltip />
                  <Area type="monotone" dataKey="value" fill="url(#gradLineFill)" stroke="none" isAnimationActive />
                  <Line type="monotone" dataKey="value" stroke="url(#gradLineStroke)" strokeWidth={THEME.chart.line.strokeWidth + 0.5}
                    dot={{ r: THEME.chart.line.dotRadius + 1, stroke: "#fff", strokeWidth: 1 }}
                    activeDot={{ r: THEME.chart.line.dotRadius + 2, stroke: "#fff", strokeWidth: 2 }} isAnimationActive />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
