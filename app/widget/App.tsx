"use client";

import React, { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
const LocationMap = dynamic(() => import("../../components/Map"), { ssr: false });

import {
  PieChart, Pie, Cell, Tooltip as RTooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, LineChart, Line, ResponsiveContainer, Legend
} from "recharts";
import { CalendarDays, MapPin, Route, RefreshCw } from "lucide-react";
import { eachDayOfInterval, format, getDay, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { it } from "date-fns/locale";

// Tema & varianti
import { THEME, type ChartVariant, solidColor } from "../theme";

/* =========================
   Tipi & Costanti
========================= */
type LatLng = { lat: number; lng: number };
type DataRow = {
  date: Date | null; adr: number; occ: number; los: number;
  channel: string; provenance: string; type: string; lat: number; lng: number
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

const WEEKDAYS = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
const STRUCTURE_TYPES = ["hotel","agriturismo","casa_vacanza","villaggio_turistico","resort","b&b","affittacamere"] as const;
const RADIUS_OPTIONS = [10,20,30] as const;
const typeLabels: Record<string,string> = {
  hotel:"Hotel", agriturismo:"Agriturismo", casa_vacanza:"Case Vacanza",
  villaggio_turistico:"Villaggi Turistici", resort:"Resort", "b&b":"B&B", affittacamere:"Affittacamere"
};

// ✅ Variante attiva: “pro” (ombre + gradienti)
//   Cambia in "flat" per stile piatto
const CHART_VARIANT: ChartVariant = "pro";

/* =========================
   Helpers estetici
========================= */
function lighten(hex: string, amount = 0.25) {
  // hex "#rrggbb" → schiarito verso bianco (amount 0..1)
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  return `rgb(${nr}, ${ng}, ${nb})`;
}

/* =========================
   Geocoding demo
========================= */
const knownPlaces: Record<string,LatLng> = {
  "castiglion fiorentino": { lat: 43.3406, lng: 11.9177 },
  "arezzo": { lat: 43.4633, lng: 11.8797 },
  "firenze": { lat: 43.7696, lng: 11.2558 },
  "siena": { lat: 43.3188, lng: 11.3308 },
};
function geocode(query: string, warnings: string[]): LatLng | null {
  const key = (query||"").trim().toLowerCase();
  if (!key) { warnings.push("Località mancante: inserisci una località per procedere"); return null; }
  if (knownPlaces[key]) return knownPlaces[key];
  warnings.push(`Località non riconosciuta ("${query}"): inserisci un indirizzo valido`);
  return null;
}

/* =========================
   Util
========================= */
function rand(min:number, max:number){ return Math.floor(Math.random()*(max-min+1))+min; }
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
    [255,255,204], [255,237,160], [254,217,118], [254,178,76], [253,141,60], [252,78,42], [227,26,28]
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
   CSV Parser Robusto
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
    .map(s => s.replace(/^\uFEFF/, ""))
    .map(s => s.replace(/^"(.*)"$/,"$1"))
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
function normalizeRows(rows: any[], warnings: string[]): DataRow[]{
  const out: DataRow[] = rows.map((r:any)=>{
    const date = toDate(String(getVal(r, ["date","data","giorno"]) ?? ""));
    const adr = toNumber(String(getVal(r, ["adr","adr_medio","prezzo_medio"]) ?? ""));
    const occ = toNumber(String(getVal(r, ["occ","occupazione","occ_rate"]) ?? ""));
    const los = toNumber(String(getVal(r, ["los","notti","soggiorno"]) ?? ""));
    const channel = String(getVal(r, ["channel","canale"]) ?? "");
    const provenance = String(getVal(r, ["provenance","country","nazione"]) ?? "");
    const type = String(getVal(r, ["type","tipo"]) ?? "");
    const lat = toNumber(String(getVal(r, ["lat","latitude"]) ?? ""));
    const lng = toNumber(String(getVal(r, ["lng","longitude"]) ?? ""));
    return { date, adr, occ, los, channel, provenance, type, lat, lng };
  });
  const valid = out.filter(r=> !!r.date);
  if (valid.length === 0) {
    warnings.push("CSV caricato ma senza colonne riconosciute (es. 'date'): controlla l'intestazione");
  }
  return valid;
}

/* =========================
   Calendario a riquadri
========================= */
function CalendarHeatmap({
  monthDate,
  data
}: { monthDate: Date; data: { date: Date; pressure: number; adr: number }[] }) {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start, end });

  const pvals = data.map(d => d.pressure).filter(Number.isFinite);
  const pmin = Math.min(...(pvals.length ? pvals : [0]));
  const pmax = Math.max(...(pvals.length ? pvals : [1]));

  const firstDow = (getDay(start) + 6) % 7; // Mon=0
  const totalCells = firstDow + days.length;
  const rows = Math.ceil(totalCells / 7);

  return (
    <div className="w-full">
      <div className="grid grid-cols-7 gap-3 text-center text-slate-600 text-sm font-semibold mb-2">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-3">
        {Array.from({ length: rows * 7 }).map((_, i) => {
          const dayIndex = i - firstDow;
          const d = days[dayIndex];
          if (dayIndex < 0 || !d) {
            return <div key={i} className="h-28 md:h-32 bg-white border rounded-2xl" />;
          }

          const dayData = data.find(x => x.date.toDateString() === d.toDateString());
          const pressure = dayData?.pressure ?? 0;
          const adr = dayData?.adr ?? 0;
          const fill = colorForPressure(pressure, pmin, pmax);
          const txt = contrastColor(fill);
          const isSat = getDay(d) === 6;

          return (
            <div
              key={i}
              className="h-28 md:h-32 rounded-2xl border-2 border-slate-700 bg-white relative overflow-hidden"
            >
              <div className="absolute inset-x-0 top-0 h-1/2 px-3 flex items-center justify-between">
                <span className={`text-sm font-semibold ${isSat ? "text-red-600" : "text-slate-800"}`}>
                  {format(d, "d", { locale: it })}
                </span>
                <span className={`text-xs ${isSat ? "text-red-600" : "text-slate-500"}`}>
                  {format(d, "eee", { locale: it })}
                </span>
              </div>
              <div
                className="absolute inset-x-0 bottom-0 h-1/2 px-3 flex items-center justify-center"
                style={{ background: fill }}
              >
                <span className="font-bold" style={{ color: txt }}>€{adr}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-center gap-4 text-slate-600">
        <span className="text-xs">Bassa domanda</span>
        <div className="h-2 w-48 rounded-full" style={{ background: "linear-gradient(90deg, rgb(255,255,204), rgb(227,26,28))" }} />
        <span className="text-xs">Alta domanda</span>
      </div>
    </div>
  );
}

/* =========================
   App
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

  const normalized: Normalized = useMemo(()=>{
    const warnings: string[] = [];
    const center = geocode(query, warnings);
    const safeR = safeRadius(radius, warnings);
    const safeT = safeTypes(types, warnings);
    if(!center){
      return { warnings, safeMonthISO: "", safeDays: [], center: null, safeR, safeT, isBlocked: true };
    }
    const safeMonthISO = safeParseMonthISO(monthISO, warnings);
    const safeDays = safeDaysOfMonth(safeMonthISO, warnings);
    return { warnings, safeMonthISO, safeDays, center, safeR, safeT, isBlocked: false };
  }, [monthISO, query, radius, types]);

  const warningsKey = useMemo(()=> normalized.warnings.join("|"), [normalized.warnings]);
  useEffect(()=>{ setNotices(prev => (prev.join("|") === warningsKey ? prev : normalized.warnings)); }, [warningsKey, normalized.warnings]);

  function buildGSheetsCsvUrl(sheetId: string, sheetName: string, gid: string, strict: boolean){
    const id = (sheetId||"").trim();
    if(!id) return { url: "", error: "" };
    if(strict){
      if(!gid || !gid.trim()){
        return { url: "", error: "Modalità rigida attiva: inserisci il GID del foglio (#gid=...)." };
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

  useEffect(()=>{
    setLoadError(null);
    setRawRows([]);
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
            const w = "Modalità non rigida: Google può ignorare il nome foglio. Per selezione certa usa il GID.";
            setNotices(prev=> Array.from(new Set([...prev, w])));
          }
        }
        if(!url){ setLoadError("Sorgente dati mancante: specifica URL CSV o Google Sheet"); return; }

        const text = await fetchCsv(url, controller.signal);
        const parsed = parseCsv(text);
        const normalizedRows = normalizeRows(parsed, warnings);
        setRawRows(normalizedRows);
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

  const monthDate = useMemo(()=> {
    if(normalized.isBlocked || !normalized.safeMonthISO) return new Date();
    try { return parseISO(normalized.safeMonthISO); } catch { return new Date(); }
  }, [normalized.safeMonthISO, normalized.isBlocked]);

  const calendarData = useMemo(()=> {
    if(normalized.isBlocked) return [];
    if(rawRows.length>0){
      const byDate = new Map<string, {date: Date; adrVals:number[]; pressVals:number[]}>();
      for(const d of normalized.safeDays){ byDate.set(d.toDateString(), { date: d, adrVals: [], pressVals: [] }); }
      rawRows.forEach(r=>{
        if(!r.date) return;
        const key = r.date.toDateString();
        const slot = byDate.get(key);
        if(slot){
          if(Number.isFinite(r.adr)) slot.adrVals.push(r.adr);
          const press = Number.isFinite(r.occ) ? (60 + r.occ) : (Number.isFinite(r.adr) ? 60 + r.adr/2 : 60);
          slot.pressVals.push(press);
        }
      });
      return Array.from(byDate.values()).map(v=> ({
        date: v.date,
        pressure: v.pressVals.length? Math.round(v.pressVals.reduce((a,b)=>a+b,0)/v.pressVals.length) : pressureFor(v.date),
        adr: v.adrVals.length? Math.round(v.adrVals.reduce((a,b)=>a+b,0)/v.adrVals.length) : adrFromCompetitors(v.date, mode)
      }));
    }
    return normalized.safeDays.map(d=>({ date:d, pressure: pressureFor(d), adr: adrFromCompetitors(d, mode) }));
  }, [normalized.safeDays, normalized.isBlocked, mode, rawRows]);

  const provenance = useMemo(()=> rawRows.length>0 ? (
    Object.entries(rawRows.reduce((acc:Record<string,number>, r)=> { const k=r.provenance||"Altro"; acc[k]=(acc[k]||0)+1; return acc; }, {}))
      .map(([name,value])=>({name,value}))
  ) : [
    { name:"Italia", value: 42 },{ name:"Germania", value: 22 },{ name:"Francia", value: 14 },{ name:"USA", value: 10 },{ name:"UK", value: 12 },
  ], [rawRows]);

  const los = useMemo(()=> rawRows.length>0 ? (()=> {
    const buckets: Record<string, number> = {"1 notte":0, "2-3 notti":0, "4-6 notti":0, "7+ notti":0};
    rawRows.forEach(r=>{
      const v = Number.isFinite(r.los)? r.los : 0;
      if(v<=1) buckets["1 notte"]++; else if(v<=3) buckets["2-3 notti"]++; else if(v<=6) buckets["4-6 notti"]++; else buckets["7+ notti"]++;
    });
    return Object.entries(buckets).map(([bucket,value])=>({bucket, value}));
  })() : [
    { bucket:"1 notte", value: 15 },{ bucket:"2-3 notti", value: 46 },{ bucket:"4-6 notti", value: 29 },{ bucket:"7+ notti", value: 10 },
  ], [rawRows]);

  const channels = useMemo(() => (
  rawRows.length > 0
    ? Object
        .entries(
          rawRows.reduce((acc: Record<string, number>, r) => {
            const k = r.channel || "Altro";
            acc[k] = (acc[k] || 0) + 1; // ← parentesi a posto qui
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
              <input type="month" value={normalized.safeMonthISO ? normalized.safeMonthISO.slice(0,7) : ""} onChange={e=> setMonthISO(`${e.target.value||""}-01`)} className="w-48 h-9 rounded-xl border border-slate-300 px-2 text-sm"/>
            </div>

            {/* Tipologie: una per riga */}
            <div className="flex items-start gap-3">
              <label className="w-28 mt-1 text-sm text-slate-700">Tipologie</label>
              <div className="flex-1 space-y-2">
                {STRUCTURE_TYPES.map(t => (
                  <label
                    key={t}
                    className="flex items-center gap-3 text-sm border border-slate-200 rounded-xl px-3 py-2 hover:bg-slate-50"
                  >
                    <input
                      className="h-4 w-4"
                      type="checkbox"
                      checked={types.includes(t)}
                      onChange={(ev) => {
                        const c = ev.currentTarget.checked;
                        setTypes(prev => c ? Array.from(new Set([...prev, t])) : prev.filter(x => x !== t));
                      }}
                    />
                    <span className="font-medium">{typeLabels[t]}</span>
                  </label>
                ))}
              </div>
            </div>

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
                  className="w-full inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border bg-slate-900 text-white border-slate-900 hover:bg-slate-800"
                  disabled={normalized.isBlocked}
                  title={normalized.isBlocked?"Inserisci la località per procedere":"Genera Analisi"}
                >
                  <RefreshCw className="h-4 w-4 mr-2"/>Genera Analisi
                </button>
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
                  label={query || "Località"}
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

          {/* Grafici — riga 1: 2 card larghe */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Provenienza (Pie con “pro”) */}
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">Provenienza Clienti</div>
              {Array.isArray(provenance) && provenance.length>0 ? (
                <ResponsiveContainer width="100%" height={340}>
                  <PieChart margin={{ bottom: 24 }}>
                    {CHART_VARIANT === "pro" ? (
                      <defs>
                        <filter id="pie-shadow" x="-20%" y="-20%" width="140%" height="140%">
                          <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodOpacity="0.25" />
                        </filter>
                        {provenance.map((_, i) => (
                          <radialGradient id={`pie-grad-${i}`} key={i} cx="50%" cy="50%" r="75%">
                            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
                            <stop offset="100%" stopColor={solidColor(i)} stopOpacity="1" />
                          </radialGradient>
                        ))}
                      </defs>
                    ) : null}

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
                      {...(CHART_VARIANT === "pro" ? { style: { filter: "url(#pie-shadow)" } } : {})}
                    >
                      {provenance.map((_, i) => (
                        <Cell
                          key={i}
                          fill={CHART_VARIANT === "pro" ? `url(#pie-grad-${i})` : solidColor(i)}
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
                    <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ color: "#111827", fontWeight: 500 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="text-xs text-slate-500">Nessun dato</div>}
            </div>

            {/* LOS (Bar con “pro”) */}
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="text-sm font-semibold mb-2">Durata Media Soggiorno (LOS)</div>
              {Array.isArray(los) && los.length>0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={los} margin={THEME.chart.bar.margin}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" tick={{fontSize: THEME.chart.bar.tickSize}} />
                    <YAxis />
                    <RTooltip />
                    {CHART_VARIANT === "pro" ? (
                      <defs>
                        <filter id="bar-shadow" x="-20%" y="-20%" width="140%" height="140%">
                          <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodOpacity="0.25" />
                        </filter>
                        {los.map((_, i) => {
                          const base = THEME.palette.barBlue[i % THEME.palette.barBlue.length];
                          return (
                            <linearGradient id={`bar-grad-los-${i}`} key={i} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={lighten(base, 0.35)} />
                              <stop offset="100%" stopColor={base} />
                            </linearGradient>
                          );
                        })}
                      </defs>
                    ) : null}
                    <Bar dataKey="value" {...(CHART_VARIANT === "pro" ? { style: { filter: "url(#bar-shadow)" } } : {})}>
                      {los.map((_,i)=> (
                        <Cell
                          key={i}
                          fill={CHART_VARIANT === "pro" ? `url(#bar-grad-los-${i})` : THEME.palette.barBlue[i % THEME.palette.barBlue.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="text-xs text-slate-500">Nessun dato</div>}
            </div>
          </div>

          {/* Canali di Vendita — riga intera (Bar con “pro”) */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Canali di Vendita</div>
            {Array.isArray(channels) && channels.length>0 ? (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={channels} margin={THEME.chart.barWide.margin}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="channel" interval={0} tick={{fontSize: THEME.chart.barWide.tickSize}} height={36} />
                  <YAxis />
                  <RTooltip />
                  {CHART_VARIANT === "pro" ? (
                    <defs>
                      <filter id="bar-shadow-2" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodOpacity="0.25" />
                      </filter>
                      {channels.map((_, i) => {
                        const base = THEME.palette.barOrange[i % THEME.palette.barOrange.length];
                        return (
                          <linearGradient id={`bar-grad-ch-${i}`} key={i} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={lighten(base, 0.35)} />
                            <stop offset="100%" stopColor={base} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                  ) : null}
                  <Bar dataKey="value" {...(CHART_VARIANT === "pro" ? { style: { filter: "url(#bar-shadow-2)" } } : {})}>
                    {channels.map((_,i)=> (
                      <Cell
                        key={i}
                        fill={CHART_VARIANT === "pro" ? `url(#bar-grad-ch-${i})` : THEME.palette.barOrange[i % THEME.palette.barOrange.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="text-xs text-slate-500">Nessun dato</div>}
          </div>

          {/* Curva domanda (Line con “pro”) */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Andamento Domanda – {format(monthDate, "LLLL yyyy", {locale: it})}</div>
            {normalized.isBlocked ? (
              <div className="text-sm text-slate-500">In attesa di località valida…</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={demand}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{fontSize: 12}} interval={3}/>
                  <YAxis />
                  <RTooltip />
                  {CHART_VARIANT === "pro" ? (
                    <defs>
                      <filter id="line-shadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="1.25" stdDeviation="1.5" floodOpacity="0.35" />
                      </filter>
                      <linearGradient id="line-grad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={lighten(THEME.chart.line.stroke, 0.3)} />
                        <stop offset="100%" stopColor={THEME.chart.line.stroke} />
                      </linearGradient>
                    </defs>
                  ) : null}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={CHART_VARIANT === "pro" ? "url(#line-grad)" : THEME.chart.line.stroke}
                    strokeWidth={THEME.chart.line.strokeWidth}
                    dot={{ r: THEME.chart.line.dotRadius }}
                    {...(CHART_VARIANT === "pro" ? { style: { filter: "url(#line-shadow)" } } : {})}
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
