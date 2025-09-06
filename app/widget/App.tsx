// app/widget/App.tsx
"use client";

import React, { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, LineChart, Line, Area, ResponsiveContainer, Legend
} from "recharts";
import { CalendarDays, MapPin, Route, RefreshCw, ChevronDown, Check } from "lucide-react";
import { eachDayOfInterval, format, getDay, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Import mappa senza SSR
const LocationMap = dynamic(() => import("../../components/Map"), { ssr: false });

/* =========================
   Tipi
========================= */
type LatLng = { lat: number; lng: number };

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
  center: LatLng | null;
  safeR: number;
  safeT: string[];
  isBlocked: boolean;
};

type ValidationIssue = {
  row: number;
  field: string;
  reason: string;
  value: string;
};

type DataStats = {
  total: number;
  valid: number;
  discarded: number;
  issuesByField: Record<string, number>;
};

/* =========================
   Costanti & Tema grafici
========================= */
const WEEKDAYS = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
const STRUCTURE_TYPES = ["hotel","agriturismo","casa_vacanza","villaggio_turistico","resort","b&b","affittacamere"] as const;
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

/* =========================
   Utilità
========================= */
function rand(min:number, max:number){ return Math.floor(Math.random()*(max-min+1))+min; }
function shade(hex: string, percent: number) {
  const m = hex.replace('#','');
  const num = parseInt(m, 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + Math.round(255 * percent)));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + Math.round(255 * percent)));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + Math.round(255 * percent)));
  return `#${(1 << 24 | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function pressureFor(date: Date){
  const dow = getDay(date); // 0 Dom
  const base = 60 + (date.getDate()*2);
  const wkndBoost = (dow===0 || dow===6) ? 25 : (dow===5 ? 18 : 0);
  return base + wkndBoost;
}
function adrFromCompetitors(date: Date, mode: "zone"|"competitor"){
  const base = 90 + (date.getDate()%7)*5;
  return Math.round(base + (mode==="competitor"? 15:0));
}
function colorForPressure(p:number, pmin:number, pmax:number){
  const spread = Math.max(1,(pmax-pmin));
  const t = (p - pmin) / spread;
  const stops = [
    [255,255,204], [255,237,160], [254,217,118], [254,178,76],
    [253,141,60], [252,78,42], [227,26,28]
  ];
  const idx = Math.min(stops.length-1, Math.max(0, Math.floor(t*(stops.length-1))));
  const [r,g,b] = stops[idx];
  return `rgb(${r},${g},${b})`;
}
function contrastColor(rgb:string){
  const m = rgb.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if(!m) return "#000";
  const r = parseInt(m[1],10), g=parseInt(m[2],10), b=parseInt(m[3],10);
  const brightness = 0.299*r + 0.587*g + 0.114*b;
  return brightness < 150 ? "#fff" : "#000";
}
function safeParseMonthISO(v:string|undefined|null, warnings:string[]): string{
  const now = new Date();
  const def = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  if(!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)){
    warnings.push("Mese non valido: fallback al mese corrente");
    return def;
  }
  return v;
}
function safeDaysOfMonth(monthISO:string, warnings:string[]): Date[]{
  try{
    const d = parseISO(monthISO);
    const start = startOfMonth(d);
    const end = endOfMonth(d);
    return eachDayOfInterval({start, end});
  }catch{
    warnings.push("Errore nel parsing data: fallback mese corrente");
    const now = new Date();
    return eachDayOfInterval({start: startOfMonth(now), end: endOfMonth(now)});
  }
}
function safeRadius(r:number, warnings:string[]): number{
  if(!(RADIUS_OPTIONS as readonly number[]).includes(r)){
    warnings.push("Raggio non valido: fallback 20km");
    return 20;
  }
  return r;
}
function safeTypes(ts:string[], warnings:string[]): string[]{
  if(!Array.isArray(ts) || ts.length===0){
    warnings.push("Nessuna tipologia selezionata: fallback a Tutte");
    return [...STRUCTURE_TYPES];
  }
  return ts.filter(t=> (STRUCTURE_TYPES as readonly string[]).includes(t));
}

/* =========================
   CSV Parser + Normalizzazione con validazione
========================= */
function smartSplit(line:string, d:string) {
  const out:string[] = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === d && !inQuotes) { out.push(cur); cur = ""; }
    else { cur += ch; }
  }
  out.push(cur);
  return out
    .map(s => s.replace(/^\uFEFF/, ""))    // BOM
    .map(s => s.replace(/^"(.*)"$/,"$1")) // virgolette attorno al campo
    .map(s => s.trim());
}
function parseCsv(text: string){
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headerLine = lines[0].replace(/^\uFEFF/, "");
  const count = (s:string, ch:string) => (s.match(new RegExp(`\\${ch}`, "g")) || []).length;
  const delim = count(headerLine, ";") > count(headerLine, ",") ? ";" : ",";
  const headersRaw = smartSplit(headerLine, delim);
  const headers = headersRaw.map(h => h.toLowerCase().trim());
  return lines.slice(1).map(line => {
    const cells = smartSplit(line, delim);
    const row:any = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    return row;
  });
}
function toNumber(v: string, def=0){
  if (v == null) return def;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
}
function toDate(v: string){
  if (!v) return null;
  const s = String(v).trim();
  const d1 = new Date(s);
  if (!Number.isNaN(d1.getTime())) return d1;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = parseInt(m[1],10), mm = parseInt(m[2],10)-1, yy = parseInt(m[3],10);
    const d2 = new Date(yy, mm, dd);
    if (!Number.isNaN(d2.getTime())) return d2;
  }
  return null;
}
function getVal(row:any, keys:string[]){
  const norm = (k:string)=> String(k||"").toLowerCase().replace(/^\uFEFF/,"").trim();
  const map = new Map<string,any>();
  Object.keys(row||{}).forEach(k => map.set(norm(k), row[k]));
  for (const k of keys) {
    const v = map.get(norm(k));
    if (v != null && v !== "") return v;
  }
  return null;
}

function normalizeRowsWithValidation(rows: any[], warnings: string[]) {
  const issues: ValidationIssue[] = [];
  const inc = (obj:Record<string,number>, k:string)=> (obj[k] = (obj[k]||0)+1, obj);

  const valid: DataRow[] = rows.map((r:any, idx:number)=>{
    const rowIndex = idx+2; // considerando intestazione
    const dateV = String(getVal(r, ["date","data","giorno"]) ?? "");
    const d = toDate(dateV);
    if(!d) issues.push({ row: rowIndex, field: "date", reason: "data non valida", value: dateV });

    const adrV = String(getVal(r, ["adr","adr_medio","prezzo_medio"]) ?? "");
    const adr = toNumber(adrV, 0);
    if(!Number.isFinite(adr)) issues.push({ row: rowIndex, field: "adr", reason: "numero non valido", value: adrV });

    const occV = String(getVal(r, ["occ","occupazione","occ_rate"]) ?? "");
    const occ = toNumber(occV, 0);

    const losV = String(getVal(r, ["los","notti","soggiorno"]) ?? "");
    const los = toNumber(losV, 0);

    const channel = String(getVal(r, ["channel","canale"]) ?? "") || "Altro";
    const provenance = String(getVal(r, ["provenance","country","nazione"]) ?? "") || "Altro";
    const type = String(getVal(r, ["type","tipo"]) ?? "") || "";

    const latV = String(getVal(r, ["lat","latitude"]) ?? "");
    const lngV = String(getVal(r, ["lng","longitude"]) ?? "");
    const lat = toNumber(latV, 0);
    const lng = toNumber(lngV, 0);

    return { date: d, adr, occ, los, channel, provenance, type, lat, lng };
  }).filter(r=> !!r.date);

  const stats: DataStats = {
    total: rows.length,
    valid: valid.length,
    discarded: Math.max(0, rows.length - valid.length),
    issuesByField: issues.reduce((acc, it)=> inc(acc, it.field), {} as Record<string,number>)
  };

  if (valid.length === 0) {
    warnings.push("CSV caricato ma senza colonne riconosciute (es. 'date'): controlla l'intestazione");
  }

  return { valid, issues, stats };
}

/* =========================
   Geocoding demo (validazione)
========================= */
const knownPlaces: Record<string,LatLng> = {
  "castiglion fiorentino": { lat: 43.3406, lng: 11.9177 },
  "arezzo": { lat: 43.4633, lng: 11.8797 },
  "firenze": { lat: 43.7696, lng: 11.2558 },
  "siena": { lat: 43.3188, lng: 11.3308 },
};
function geocode(query: string, warnings: string[]): LatLng | null {
  const key = (query||"").trim().toLowerCase();
  if(!key){
    warnings.push("Località mancante: inserisci una località per procedere");
    return null;
  }
  if(knownPlaces[key]) return knownPlaces[key];
  warnings.push(`Località non riconosciuta ("${query}"): inserisci un indirizzo valido`);
  return null;
}

/* =========================
   Helper per query string (URL share)
========================= */
function parseListParam(s?: string | null) {
  if (!s) return [];
  return s.split(",").map(decodeURIComponent).map(v => v.trim()).filter(Boolean);
}
function parseNumParam(s?: string | null, def = 0) {
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
}

// Costruisce l'URL con i filtri
function makeShareUrl(
  pathname: string,
  opts: {
    q: string; r: number; m: string; t: string[]; mode: "zone"|"competitor";
    dataSource: "none"|"csv"|"gsheet"; csvUrl: string; gsId: string; gsGid: string; gsSheet: string;
  }
) {
  const params = new URLSearchParams();
  params.set("q", opts.q);
  params.set("r", String(opts.r));
  params.set("m", opts.m.slice(0, 7)); // YYYY-MM
  if (opts.t.length > 0 && opts.t.length < (STRUCTURE_TYPES as readonly string[]).length) {
    params.set("t", opts.t.map(encodeURIComponent).join(","));
  }
  params.set("mode", opts.mode);

  // sorgente dati
  if (opts.dataSource === "csv" && opts.csvUrl) {
    params.set("src", "csv");
    params.set("csv", opts.csvUrl);
  } else if (opts.dataSource === "gsheet" && opts.gsId) {
    params.set("src", "gsheet");
    params.set("id", opts.gsId);
    if (opts.gsGid) params.set("gid", opts.gsGid);
    if (opts.gsSheet) params.set("sheet", opts.gsSheet);
  }
  return `${pathname}?${params.toString()}`;
}

// Aggiorna l’URL (router + fallback) e ritorna il path con query
function replaceUrlWithState(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  opts: {
    q: string; r: number; m: string; t: string[]; mode: "zone"|"competitor";
    dataSource: "none"|"csv"|"gsheet"; csvUrl: string; gsId: string; gsGid: string; gsSheet: string;
  }
) {
  const url = makeShareUrl(pathname, opts);
  try { router.replace(url, { scroll: false }); } catch {}
  try {
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", url);
    }
  } catch {}
  return url;
}

/* =========================
   Calendario Heatmap
========================= */
function CalendarHeatmap({
  monthDate,
  data
}:{monthDate: Date; data: {date: Date; pressure:number; adr:number; holidayName?: string; wx?: {t?:number; p?:number}}[]}){
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const days = eachDayOfInterval({start, end});
  const pvals = data.map(d=>d.pressure).filter(Number.isFinite);
  const pmin = Math.min(...(pvals.length? pvals : [0]));
  const pmax = Math.max(...(pvals.length? pvals : [1]));
  const firstDow = (getDay(start)+6)%7; // Mon=0
  const totalCells = firstDow + days.length;
  const rows = Math.ceil(totalCells/7);

  return (
    <div className="w-full">
      {/* Intestazione giorni */}
      <div className="text-sm mb-1 grid grid-cols-7 gap-px text-center text-neutral-500">
        {WEEKDAYS.map((w,i)=> <div key={i} className="py-1 font-medium">{w}</div>)}
      </div>

      {/* Griglia */}
      <div className="grid grid-cols-7 gap-3">
        {Array.from({length: rows*7}).map((_,i)=>{
          const dayIndex = i - firstDow;
          const d = days[dayIndex];
          const dayData = d && data.find(x=> x.date.toDateString()===d.toDateString());
          if(dayIndex<0 || !d){
            return <div key={i} className="h-24 bg-white border border-black/20 rounded-2xl"/>;
          }
          const isSat = ((getDay(d))===6);
          const pressure = dayData?.pressure ?? 0;
          const adr = dayData?.adr ?? 0;
          const fill = colorForPressure(pressure,pmin,pmax);
          const txtColor = contrastColor(fill);
          return (
            <div key={i} className="h-24 rounded-2xl border-2 border-black relative overflow-hidden">
              {/* Top half: giorno + settimana */}
              <div className="absolute inset-x-0 top-0 h-1/2 bg-white px-2 flex items-center justify-between">
                <span className={`text-sm ${isSat?"text-red-600":"text-black"}`}>{format(d,"d",{locale:it})}</span>
                <span className={`text-xs ${isSat?"text-red-600":"text-neutral-600"}`}>{format(d,"EEE",{locale:it})}</span>
              </div>
              {/* Bottom half: ADR con sfondo domanda */}
              <div className="absolute inset-x-0 bottom-0 h-1/2 px-2 flex items-center justify-center" style={{background: fill}}>
                <span className="font-bold" style={{color: txtColor}}>€{adr}</span>
              </div>

              {/* Badge Festività */}
              {dayData?.holidayName ? (
                <div
                  className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-rose-500"
                  title={dayData.holidayName}
                />
              ) : null}

              {/* Mini meteo (temperatura media del giorno) */}
              {dayData?.wx?.t != null ? (
                <div className="absolute bottom-1 right-1 text-[10px] text-neutral-700/80">
                  {dayData.wx.t.toFixed(0)}°C
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Legenda */}
      <div className="mt-3 flex items-center justify-center gap-4">
        <span className="text-xs">Bassa domanda</span>
        <div className="h-2 w-48 rounded-full" style={{background:"linear-gradient(90deg, rgb(255,255,204), rgb(227,26,28))"}}/>
        <span className="text-xs">Alta domanda</span>
      </div>
    </div>
  );
}

/* =========================
   APP
========================= */
export default function App(){
  const [notices, setNotices] = useState<string[]>([]);
  const [mode, setMode] = useState<"zone"|"competitor">("zone");
  const [query, setQuery] = useState("Castiglion Fiorentino");
  const [radius, setRadius] = useState<number>(20);
  const [monthISO, setMonthISO] = useState("2025-08-01");
  const [types, setTypes] = useState<string[]>(["agriturismo","b&b","hotel"]);

  const [dataSource, setDataSource] = useState<"none"|"csv"|"gsheet">("none");
  const [csvUrl, setCsvUrl] = useState("");
  const [gsId, setGsId] = useState("");
  const [gsSheet, setGsSheet] = useState("Sheet1");
  const [gsGid, setGsGid] = useState("");
  const [strictSheet, setStrictSheet] = useState(true);

  const [rawRows, setRawRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // === Dati esterni ===
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [weatherByDate, setWeatherByDate] = useState<Record<string, { t?: number; p?: number }>>({});

  // ===== Dropdown Multi-Select Tipologie =====
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
    const [open, setOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement | null>(null);

    // Chiudi clic fuori
    React.useEffect(() => {
      function onClickOutside(e: MouseEvent) {
        if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
      }
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }, []);

    // Toggle singolo tipo
    function toggle(t: string) {
      onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
    }

    // Testo riepilogo (badge)
    const summary =
      value.length === 0
        ? "Nessuna"
        : value.length === allTypes.length
        ? "Tutte"
        : `${value.length} selezionate`;

    return (
      <div className="relative" ref={containerRef}>
        <span className="block text-sm font-medium text-neutral-700 mb-1">
          Tipologie
        </span>

        {/* Trigger */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full h-10 rounded-xl border border-neutral-300 bg-white px-3 text-left flex items-center justify-between hover:border-neutral-400 transition"
        >
          <span className="truncate">
            {summary}
            {value.length > 0 && value.length < allTypes.length ? (
              <span className="ml-2 text-xs text-neutral-500">
                {value
                  .slice()
                  .sort()
                  .map((t) => labels[t] || t)
                  .slice(0, 2)
                  .join(", ")}
                {value.length > 2 ? "…" : ""}
              </span>
            ) : null}
          </span>
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>

        {/* Panel */}
        {open && (
          <div
            className="absolute z-50 mt-2 w-full rounded-2xl border bg-white shadow-lg p-2"
            role="listbox"
            aria-label="Seleziona tipologie"
          >
            <div className="pr-1 md:max-h-none md:overflow-visible max-h-none overflow-visible">
              <ul className="space-y-1">
                {allTypes.map((t) => {
                  const active = value.includes(t);
                  return (
                    <li key={t}>
                      <button
                        type="button"
                        onClick={() => toggle(t)}
                        className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition
                          ${active ? "bg-slate-50" : "hover:bg-neutral-50"}`}
                        role="option"
                        aria-selected={active}
                      >
                        <span
                          className={`inline-flex h-5 w-5 items-center justify-center rounded-md border
                            ${active ? "bg-slate-900 border-slate-900" : "bg-white border-neutral-300"}`}
                        >
                          {active ? <Check className="h-3.5 w-3.5 text-white" /> : null}
                        </span>
                        <span className="text-neutral-800">{labels[t] || t}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Footer azioni rapide */}
            <div className="mt-2 flex items-center justify-between border-t pt-2">
              <button
                type="button"
                className="text-xs text-neutral-600 hover:text-neutral-900"
                onClick={() => onChange([])}
              >
                Pulisci
              </button>
              <div className="space-x-2">
                <button
                  type="button"
                  className="text-xs text-neutral-600 hover:text-neutral-900"
                  onClick={() => onChange([...allTypes])}
                >
                  Seleziona tutte
                </button>
                <button
                  type="button"
                  className="text-xs rounded-md bg-slate-900 text-white px-2 py-1 hover:bg-slate-800"
                  onClick={() => setOpen(false)}
                >
                  Applica
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Stati APPLICATI (si aggiornano solo cliccando "Genera Analisi")
  const [aQuery, setAQuery] = useState(query);
  const [aRadius, setARadius] = useState(radius);
  const [aMonthISO, setAMonthISO] = useState(monthISO);
  const [aTypes, setATypes] = useState<string[]>(types);
  const [aMode, setAMode] = useState<"zone"|"competitor">(mode);

  const hasChanges = useMemo(() =>
    aQuery !== query ||
    aRadius !== radius ||
    aMonthISO !== monthISO ||
    aMode !== mode ||
    aTypes.join(",") !== types.join(","),
  [aQuery, query, aRadius, radius, aMonthISO, monthISO, aMode, mode, aTypes, types]);

  // Validazione: stats/issues
  const [dataStats, setDataStats] = useState<DataStats | null>(null);
  const [dataIssues, setDataIssues] = useState<ValidationIssue[]>([]);
  const [showIssueDetails, setShowIssueDetails] = useState(false);

  // Normalizzazione — usa gli *applicati*
  const normalized: Normalized = useMemo(()=>{
    const warnings: string[] = [];
    const center = geocode(aQuery, warnings);
    const safeR = safeRadius(aRadius, warnings);
    const safeT = safeTypes(aTypes, warnings);
    if(!center){
      return { warnings, safeMonthISO: "", safeDays: [], center: null, safeR, safeT, isBlocked: true };
    }
    const safeMonthISO = safeParseMonthISO(aMonthISO, warnings);
    const safeDays = safeDaysOfMonth(safeMonthISO, warnings);
    return { warnings, safeMonthISO, safeDays, center, safeR, safeT, isBlocked: false };
  }, [aMonthISO, aQuery, aRadius, aTypes]);

  // Avvisi
  useEffect(()=>{
    const warningsKey = normalized.warnings.join("|");
    setNotices(prev => (prev.join("|") === warningsKey ? prev : normalized.warnings));
  }, [normalized.warnings]);

  /* ---------- URL share ---------- */
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [shareUrl, setShareUrl] = useState<string>("");

  // Inizializza stato da URL al mount
  useEffect(() => {
    if (!search) return;

    const q = search.get("q") ?? query;
    const r = parseNumParam(search.get("r"), radius);
    const m = search.get("m") ? `${search.get("m")}-01` : monthISO;

    const rawT = parseListParam(search.get("t"));
    const validT = rawT.filter(x => (STRUCTURE_TYPES as readonly string[]).includes(x));
    const t = validT.length ? validT : types;

    const modeParam = (search.get("mode") === "competitor" ? "competitor" : "zone") as "zone"|"competitor";

    const src = (search.get("src") as "none"|"csv"|"gsheet") ?? dataSource;
    const csv = search.get("csv") ?? csvUrl;
    const id  = search.get("id")  ?? gsId;
    const gid = search.get("gid") ?? gsGid;
    const sheet = search.get("sheet") ?? gsSheet;

    // UI state
    setQuery(q); setRadius(r); setMonthISO(m); setTypes(t); setMode(modeParam);
    setDataSource(src); setCsvUrl(csv); setGsId(id); setGsGid(gid ?? ""); setGsSheet(sheet ?? "");

    // Applicati
    setAQuery(q); setARadius(r); setAMonthISO(m); setATypes(t); setAMode(modeParam);

    // Link condivisibile iniziale
    const url = makeShareUrl(pathname || "/", {
      q, r, m, t, mode: modeParam,
      dataSource: src, csvUrl: csv, gsId: id || "", gsGid: gid || "", gsSheet: sheet || ""
    });
    setShareUrl(url);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL builder CSV/Sheet
  function buildGSheetsCsvUrl(sheetId: string, sheetName: string, gid: string, strict: boolean){
    const id = (sheetId||"").trim();
    if(!id) return { url: "", error: "" };

    if(strict){
      if(!gid || !gid.trim()){
        return { url: "", error: "Modalità rigida attiva: inserisci il GID del foglio (#gid=...)."};
      }
      return { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${encodeURIComponent(gid.trim())}`, error: "" };
    }

    const name = encodeURIComponent(sheetName||"Sheet1");
    return { url: `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${name}`, error: "" };
  }
  async function fetchCsv(url: string, signal?: AbortSignal): Promise<string>{
    const res = await fetch(url, { signal });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  /* ---------- Festività & Meteo ---------- */
  useEffect(() => {
    if (!monthISO) return;
    const y = Number(monthISO.slice(0, 4));

    fetch(`/api/external/holidays?year=${y}&country=IT`)
      .then(r => r.json())
      .then((j) => {
        if (!j?.ok) return;
        const map: Record<string, string> = {};
        (j.holidays || []).forEach((h: any) => { map[h.date] = h.localName || h.name; });
        setHolidays(map);
      })
      .catch(() => { /* fallback: nessuna festività */ });
  }, [monthISO]);

  useEffect(() => {
    if (!normalized.center || !monthISO) { setWeatherByDate({}); return; }
    const { lat, lng } = normalized.center;

    fetch(`/api/external/weather?lat=${lat}&lng=${lng}&monthISO=${encodeURIComponent(monthISO)}`)
      .then(r => r.json())
      .then((j) => {
        if (!j?.ok || !j.weather?.daily) { setWeatherByDate({}); return; }
        const daily = j.weather.daily;
        const out: Record<string, { t?: number; p?: number }> = {};
        (daily.time || []).forEach((d: string, i: number) => {
          out[d] = {
            t: Array.isArray(daily.temperature_2m_mean) ? daily.temperature_2m_mean[i] : undefined,
            p: Array.isArray(daily.precipitation_sum) ? daily.precipitation_sum[i] : undefined,
          };
        });
        setWeatherByDate(out);
      })
      .catch(() => setWeatherByDate({}));
  }, [normalized.center, monthISO]);

  // Caricamento dati (CSV / Google Sheet)
  useEffect(()=>{
    setLoadError(null);
    setRawRows([]);
    setDataStats(null);
    setDataIssues([]);
    if(dataSource === "none") return;

    const warnings: string[] = [];
    const controller = new AbortController();
    const run = async ()=>{
      try{
        setLoading(true);

        let url = "";
        if(dataSource === "csv"){
          url = csvUrl.trim();
        } else {
          const built = buildGSheetsCsvUrl(gsId, gsSheet, gsGid, strictSheet);
          if(built.error){
            setLoadError(built.error);
            setNotices(prev=> Array.from(new Set([...prev, built.error])));
            return;
          }
          url = built.url;
          if(!strictSheet){
            const w = "Modalità non rigida: Google potrebbe ignorare il nome foglio e restituire il primo foglio. Per selezione certa usa il GID.";
            setNotices(prev=> Array.from(new Set([...prev, w])));
          }
        }
        if(!url){ setLoadError("Sorgente dati mancante: specifica URL CSV o Google Sheet"); return; }

        const text = await fetchCsv(url, controller.signal);
        const parsed = parseCsv(text);
        const { valid, issues, stats } = normalizeRowsWithValidation(parsed, warnings);
        setRawRows(valid);
        setDataStats(stats);
        setDataIssues(issues);
        if(warnings.length>0) setNotices(prev=> Array.from(new Set([...prev, ...warnings])));
      }catch(e:any){
        setLoadError(String(e?.message || e));
      }finally{
        setLoading(false);
      }
    };
    run();
    return ()=> controller.abort();
  }, [dataSource, csvUrl, gsId, gsSheet, gsGid, strictSheet]);

  // Mese scelto (da applicati)
  const monthDate = useMemo(()=> {
    if(normalized.isBlocked || !normalized.safeMonthISO) return new Date();
    try { return parseISO(normalized.safeMonthISO); } catch { return new Date(); }
  }, [normalized.safeMonthISO, normalized.isBlocked]);

  // === Calendario: domanda + ADR (+ festività/meteo) ===
  const calendarData = useMemo(() => {
    if (normalized.isBlocked) return [];

    if (rawRows.length > 0) {
      const byDate = new Map<string, { date: Date; adrVals: number[]; pressVals: number[] }>();
      for (const d of normalized.safeDays) {
        byDate.set(d.toDateString(), { date: d, adrVals: [], pressVals: [] });
      }
      rawRows.forEach(r => {
        if (!r.date) return;
        const key = r.date.toDateString();
        const slot = byDate.get(key);
        if (!slot) return;
        if (Number.isFinite(r.adr)) slot.adrVals.push(r.adr);
        const press = Number.isFinite(r.occ) ? (60 + r.occ) : (Number.isFinite(r.adr) ? 60 + r.adr / 2 : 60);
        slot.pressVals.push(press);
      });

      return Array.from(byDate.values()).map(v => {
        const dISO = format(v.date, "yyyy-MM-dd");
        const base = {
          date: v.date,
          pressure: v.pressVals.length
            ? Math.round(v.pressVals.reduce((a, b) => a + b, 0) / v.pressVals.length)
            : pressureFor(v.date),
          adr: v.adrVals.length
            ? Math.round(v.adrVals.reduce((a, b) => a + b, 0) / v.adrVals.length)
            : adrFromCompetitors(v.date, aMode),
        };
        return {
          ...base,
          holidayName: holidays[dISO],
          wx: weatherByDate[dISO] || undefined,
        };
      });
    }

    // DEMO
    return normalized.safeDays.map(d => {
      const dISO = format(d, "yyyy-MM-dd");
      return {
        date: d,
        pressure: pressureFor(d),
        adr: adrFromCompetitors(d, aMode),
        holidayName: holidays[dISO],
        wx: weatherByDate[dISO] || undefined,
      };
    });
  }, [normalized.safeDays, normalized.isBlocked, aMode, rawRows, holidays, weatherByDate]);

  // Grafici: Provenienza / LOS / Canali
  const provenance = useMemo(()=> rawRows.length>0 ? (
    Object.entries(rawRows.reduce((acc:Record<string,number>, r)=> { const k=r.provenance||"Altro"; acc[k]=(acc[k]||0)+1; return acc; }, {}))
      .map(([name,value])=>({name,value}))
  ) : [
    { name:"Italia", value: 42 },
    { name:"Germania", value: 22 },
    { name:"Francia", value: 14 },
    { name:"USA", value: 10 },
    { name:"UK", value: 12 },
  ], [rawRows]);

  const los = useMemo(()=> rawRows.length>0 ? (()=> {
    const buckets: Record<string, number> = {"1 notte":0, "2-3 notti":0, "4-6 notti":0, "7+ notti":0};
    rawRows.forEach(r=>{
      const v = Number.isFinite(r.los)? r.los : 0;
      if(v<=1) buckets["1 notte"]++;
      else if(v<=3) buckets["2-3 notti"]++;
      else if(v<=6) buckets["4-6 notti"]++;
      else buckets["7+ notti"]++;
    });
    return Object.entries(buckets).map(([bucket,value])=>({bucket, value}));
  })() : [
    { bucket:"1 notte", value: 15 },
    { bucket:"2-3 notti", value: 46 },
    { bucket:"4-6 notti", value: 29 },
    { bucket:"7+ notti", value: 10 },
  ], [rawRows]);

  const channels = useMemo(() => (
    rawRows.length > 0
      ? Object
          .entries(
            rawRows.reduce((acc: Record<string, number>, r) => {
              const k = r.channel || "Altro";
              acc[k] = (acc[k] || 0) + 1;
              return acc;
            }, {})
          )
          .map(([channel, value]) => ({ channel, value }))
      : [
          { channel: "Booking", value: 36 },
          { channel: "Airbnb", value: 26 },
          { channel: "Diretto", value: 22 },
          { channel: "Expedia", value: 11 },
          { channel: "Altro", value: 5 },
        ]
  ), [rawRows]);

  const demand = useMemo(()=> (
    normalized.isBlocked ? [] : (rawRows.length>0
      ? calendarData.map(d=> ({ date: format(d.date, "d MMM", {locale:it}), value: d.pressure }))
      : normalized.safeDays.map(d=> ({ date: format(d, "d MMM", {locale:it}), value: pressureFor(d) + rand(-10,10) }))
    )
  ), [normalized.safeDays, normalized.isBlocked, calendarData, rawRows]);


  /* =========== UI =========== */

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar */}
      <div className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Widget Analisi Domanda – Hospitality</h1>
            <p className="text-sm text-slate-600">UI pulita: layout arioso, controlli chiari, grafici leggibili.</p>
          </div>
          <button
            className="px-3 py-2 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-800"
            onClick={()=> location.reload()}
            title="Reset"
          >
            <span className="inline-flex items-center gap-2"><RefreshCw className="w-4 h-4"/> Reset</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">

        {/* SIDEBAR CONTROLLI */}
        <aside className="space-y-6">
          {/* Sorgente dati */}
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

          {/* Località / Raggio / Mese / Tipologie */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-slate-700"/>
              <label className="w-28 text-sm text-slate-700">Località</label>
              <input className="w-full h-9 rounded-xl border border-slate-300 px-2 text-sm" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Città o indirizzo"/>
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

            {/* Tipologie (dropdown multiselect) */}
            <TypesMultiSelect
              value={types}
              onChange={setTypes}
              allTypes={STRUCTURE_TYPES}
              labels={typeLabels}
            />

            {/* Modalità + Pulsante su riga propria */}
            <div className="grid grid-cols-1 gap-3 mt-2">
              <div className="flex items-center gap-3">
                <label className="w-28 text-sm text-slate-700">Modalità</label>
                <div className="inline-flex rounded-xl border overflow-hidden">
                  <button className={`px-3 py-1 text-sm ${mode==="zone"?"bg-slate-900 text-white":"bg-white text-slate-900"}`} onClick={()=> setMode("zone")}>Zona</button>
                  <button className={`px-3 py-1 text-sm ${mode==="competitor"?"bg-slate-900 text-white":"bg-white text-slate-900"}`} onClick={()=> setMode("competitor")}>Competitor</button>
                </div>
              </div>

              <div>
                <button
                  className="w-full inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border bg-slate-900 text-white border-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={normalized.isBlocked || !hasChanges}
                  title={
                    normalized.isBlocked
                      ? "Inserisci la località per procedere"
                      : (hasChanges ? "Applica i filtri" : "Nessuna modifica da applicare")
                  }
                  onClick={() => {
                    // Applica i valori correnti della UI
                    const next = {
                      q: query, r: radius, m: monthISO, t: types, mode,
                      dataSource, csvUrl, gsId, gsGid, gsSheet
                    };
                    setAQuery(next.q);
                    setARadius(next.r);
                    setAMonthISO(next.m);
                    setATypes(next.t);
                    setAMode(next.mode);

                    // Aggiorna l'URL (link condivisibile) e mostra il link
                    const url = replaceUrlWithState(router, pathname || "/", next);
                    setShareUrl(url);
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2"/>
                  {hasChanges ? "Genera Analisi" : "Aggiornato"}
                </button>

                {/* Campo: Link condivisibile */}
                {shareUrl && (
                  <div className="mt-2">
                    <label className="block text-xs text-slate-600 mb-1">Link condivisibile</label>
                    <input
                      className="w-full h-9 rounded-xl border border-slate-300 px-2 text-xs"
                      value={
                        typeof window !== "undefined"
                          ? `${location.origin}${shareUrl}`
                          : shareUrl
                      }
                      readOnly
                      onFocus={(e)=> e.currentTarget.select()}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Avvisi */}
          {notices.length>0 && (
            <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="text-sm font-semibold text-amber-900">Avvisi</div>
              <ul className="list-disc ml-5 text-sm text-amber-900">
                {notices.map((n,i)=> <li key={i}>{n}</li>)}
              </ul>
            </section>
          )}

          {/* Qualità dati */}
          {dataStats && (
            <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
              <div className="text-sm font-semibold">Qualità dati (Google Sheet)</div>

              <div className="text-xs text-slate-600">
                Totale righe: <b>{dataStats.total}</b> ·{" "}
                Valide: <b className="text-emerald-700">{dataStats.valid}</b> ·{" "}
                Scartate: <b className={dataStats.discarded ? "text-rose-700" : "text-slate-700"}>{dataStats.discarded}</b>
              </div>

              {Object.keys(dataStats.issuesByField).length>0 && (
                <div className="text-xs">
                  <div className="font-medium mb-1">Problemi rilevati (per campo)</div>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(dataStats.issuesByField).map(([field,count])=> (
                      <li key={field} className="flex justify-between">
                        <span className="text-slate-600">{field}</span>
                        <span className="font-semibold">{count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {dataIssues.length>0 && (
                <div>
                  <button
                    type="button"
                    className="text-xs underline text-slate-700"
                    onClick={()=> setShowIssueDetails(s=>!s)}
                  >
                    {showIssueDetails ? "Nascondi dettagli" : "Mostra esempi (prime 10 righe problematiche)"}
                  </button>

                  {showIssueDetails && (
                    <div className="mt-2 max-h-40 overflow-auto rounded-lg border bg-slate-50 p-2">
                      <table className="w-full text-[11px]">
                        <thead className="text-slate-500">
                          <tr>
                            <th className="text-left px-1">riga</th>
                            <th className="text-left px-1">campo</th>
                            <th className="text-left px-1">motivo</th>
                            <th className="text-left px-1">valore</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dataIssues.slice(0,10).map((iss, i)=> (
                            <tr key={i} className="border-t">
                              <td className="px-1">{iss.row}</td>
                              <td className="px-1">{iss.field}</td>
                              <td className="px-1">{iss.reason}</td>
                              <td className="px-1 truncate">{iss.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </aside>

        {/* MAIN */}
        <main className="space-y-6">
          {/* MAPPA – riga intera */}
          <div className="bg-white rounded-2xl border shadow-sm p-0">
            <div className="h-72 md:h-[400px] lg:h-[480px] overflow-hidden rounded-2xl">
              {normalized.center ? (
                <LocationMap
                  center={[normalized.center.lat, normalized.center.lng]}
                  radius={normalized.safeR*1000}
                  label={aQuery || "Località"}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-slate-500">
                  Inserisci una località valida per visualizzare la mappa e generare l'analisi
                </div>
              )}
            </div>
          </div>

          {/* CALENDARIO – riga intera */}
          <div className="bg-white rounded-2xl border shadow-sm p-6">
            <div className="text-lg font-semibold mb-3">
              Calendario Domanda + ADR – {format(monthDate, "LLLL yyyy", { locale: it })}
            </div>
            {normalized.isBlocked ? (
              <div className="text-sm text-slate-500">
                Nessuna analisi disponibile: inserisci una località valida.
              </div>
            ) : (
              <CalendarHeatmap monthDate={monthDate} data={calendarData} />
            )}
          </div>

          {/* =========================
              GRAFICI – blocco completo
          ======================== */}

          {/* Riga 1: Provenienza (Pie) + LOS (Bar) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Provenienza (Pie) */}
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">Provenienza Clienti</div>
              {Array.isArray(provenance) && provenance.length>0 ? (
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
                      label={({ percent }) => `${Math.round((percent || 0)*100)}%`}
                      isAnimationActive={true}
                      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.15))" }}
                    >
                      {provenance.map((_, i) => (
                        <Cell
                          key={i}
                          fill={`url(#gradSlice-${i})`}
                          stroke="#ffffff"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>

                    <RTooltip
                      formatter={(val: any, name: any, props: any) => {
                        const total = (provenance || []).reduce((a, b) => a + (b.value as number), 0);
                        const pct = total ? Math.round((props?.value / total) * 100) : 0;
                        return [`${props?.value} (${pct}%)`, name];
                      }}
                    />
                    <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ color: "#111827", fontWeight: 600 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-xs text-slate-500">Nessun dato</div>
              )}
            </div>

            {/* LOS (Bar) */}
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">Durata Media Soggiorno (LOS)</div>
              {Array.isArray(los) && los.length>0 ? (
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
                    <XAxis dataKey="bucket" tick={{fontSize: THEME.chart.bar.tickSize}} />
                    <YAxis />
                    <RTooltip />
                    <Bar dataKey="value" radius={[8,8,0,0]}>
                      {los.map((_,i)=> (
                        <Cell key={i} fill={`url(#gradBarLOS-${i})`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-xs text-slate-500">Nessun dato</div>
              )}
            </div>
          </div>

          {/* Canali di Vendita — riga intera (Bar) */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Canali di Vendita</div>
            {Array.isArray(channels) && channels.length>0 ? (
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
                  <XAxis dataKey="channel" interval={0} tick={{fontSize: THEME.chart.barWide.tickSize}} height={40} />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" radius={[8,8,0,0]}>
                    {channels.map((_,i)=> (
                      <Cell key={i} fill={`url(#gradBarCH-${i})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs text-slate-500">Nessun dato</div>
            )}
          </div>

          {/* Andamento Domanda — riga intera (Line + Area soft) */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">
              Andamento Domanda – {format(monthDate, "LLLL yyyy", { locale: it })}
            </div>
            {(!demand || demand.length===0) ? (
              <div className="text-sm text-slate-500">In attesa di località valida…</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={demand}>
                  <defs>
                    {/* Gradiente per la linea */}
                    <linearGradient id="gradLineStroke" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={shade(THEME.chart.line.stroke, 0.15)} />
                      <stop offset="100%" stopColor={shade(THEME.chart.line.stroke, -0.10)} />
                    </linearGradient>
                    {/* Gradiente per l’area sotto la linea */}
                    <linearGradient id="gradLineFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={shade(THEME.chart.line.stroke, 0.25)} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={shade(THEME.chart.line.stroke, -0.20)} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{fontSize: 12}} interval={3}/>
                  <YAxis />
                  <RTooltip />
                  {/* Area soft per profondità */}
                  <Area
                    type="monotone"
                    dataKey="value"
                    fill="url(#gradLineFill)"
                    stroke="none"
                    isAnimationActive={true}
                  />
                  {/* Linea con gradiente + puntini rifiniti */}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="url(#gradLineStroke)"
                    strokeWidth={THEME.chart.line.strokeWidth + 0.5}
                    dot={{ r: THEME.chart.line.dotRadius + 1, stroke: "#fff", strokeWidth: 1 }}
                    activeDot={{ r: THEME.chart.line.dotRadius + 2, stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive={true}
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
