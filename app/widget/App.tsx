"use client";

import React, { useMemo, useState, useEffect } from "react";
import LocationMap from "../../components/Map";
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, LineChart, Line, ResponsiveContainer, Legend
} from "recharts";
import { CalendarDays, MapPin, Route, RefreshCw } from "lucide-react";
import { eachDayOfInterval, format, getDay, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { it } from "date-fns/locale";

// ---------- Tipi ----------
type LatLng = { lat: number; lng: number };
type DataRow = {
  date: Date|null; adr: number; occ: number; los: number;
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

// ---------- Costanti ----------
const WEEKDAYS = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];
const STRUCTURE_TYPES = ["hotel","agriturismo","casa_vacanza","villaggio_turistico","resort","b&b","affittacamere"] as const;
const RADIUS_OPTIONS = [10,20,30] as const;
const typeLabels: Record<string,string> = {
  hotel:"Hotel", agriturismo:"Agriturismo", casa_vacanza:"Case Vacanza",
  villaggio_turistico:"Villaggi Turistici", resort:"Resort", "b&b":"B&B", affittacamere:"Affittacamere"
};

// ---------- Geocoding demo (blocca se invalida) ----------
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

// ---------- Util ----------
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

// ---------- Parser CSV ROBUSTO (+ helpers) ----------
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

// ---------- Calendario Heatmap (✓ reinserito) ----------
function CalendarHeatmap({
  monthDate,
  data
}:{monthDate: Date; data: {date: Date; pressure:number; adr:number}[]}){
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
    <div className="w-full overflow-x-auto">
      <div className="text-sm mb-1 grid grid-cols-7 gap-px text-center text-neutral-500">
        {WEEKDAYS.map((w,i)=> <div key={i} className="py-1 font-medium">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({length: rows*7}).map((_,i)=>{
          const dayIndex = i - firstDow;
          const d = days[dayIndex];
          const dayData = data.find(x=> x.date.toDateString()===d?.toDateString());
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
              <div className="absolute inset-x-0 top-0 h-1/2 bg-white px-2 flex items-center">
                <span className={`text-sm ${isSat?"text-red-600":"text-black"}`}>{format(d,"d EEE",{locale:it})}</span>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1/2 px-2 flex items-center justify-center" style={{background: fill}}>
                <span className="font-bold" style={{color: txtColor}}>€{adr}</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center justify-center gap-4">
        <span className="text-xs">Bassa domanda</span>
        <div className="h-2 w-48 rounded-full" style={{background:"linear-gradient(90deg, rgb(255,255,204), rgb(227,26,28))"}}/>
        <span className="text-xs">Alta domanda</span>
      </div>
    </div>
  );
}

// ---------- App ----------
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
  const [gsGid, setGsGid] = useState("");               // GID del foglio (es. 0)
  const [strictSheet, setStrictSheet] = useState(true); // Modalità rigida ON

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

  // Avvisi
  const warningsKey = useMemo(()=> normalized.warnings.join("|"), [normalized.warnings]);
  useEffect(()=>{ setNotices(prev => (prev.join("|") === warningsKey ? prev : normalized.warnings)); }, [warningsKey, normalized.warnings]);

  // URL builder (rigida vs non rigida)
  function buildGSheetsCsvUrl(sheetId: string, sheetName: string, gid: string, strict: boolean){
    const id = (sheetId||"").trim();
    if(!id) return { url: "", error: "" };

    if(strict){
      if(!gid || !gid.trim()){
        return { url: "", error: "Modalità rigida attiva: inserisci il GID del foglio (lo trovi nell'URL dopo #gid=...)." };
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

  // Caricamento dati (CSV / Google Sheet)
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
            const w = "Modalità non rigida: Google potrebbe ignorare il nome foglio e restituire il primo foglio. Per selezione certa usa il GID.";
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

  // Mese scelto
  const monthDate = useMemo(()=> {
    if(normalized.isBlocked || !normalized.safeMonthISO) return new Date();
    try { return parseISO(normalized.safeMonthISO); } catch { return new Date(); }
  }, [normalized.safeMonthISO, normalized.isBlocked]);

  // Dati calendario + ADR medio competitor
  const calendarData = useMemo(()=> {
    if(normalized.isBlocked) return [];
    if(rawRows.length>0){
      const byDate = new globalThis.Map<string, {date: Date; adrVals:number[]; pressVals:number[]}>();
      for(const d of normalized.safeDays){
        byDate.set(d.toDateString(), { date: d, adrVals: [], pressVals: [] });
      }
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

  // Grafici: Provenienza / LOS / Canali (con fallback demo se niente CSV)
  const provenance = useMemo(()=> {
    if(rawRows.length>0){
      const counts: Record<string, number> = {};
      rawRows.forEach(r=>{ const k=(r.provenance||"Altro")||"Altro"; counts[k]=(counts[k]||0)+1; });
      return Object.entries(counts).map(([name,value])=>({name,value}));
    }
    return [
      { name:"Italia", value: 42 },
      { name:"Germania", value: 22 },
      { name:"Francia", value: 14 },
      { name:"USA", value: 10 },
      { name:"UK", value: 12 },
    ];
  }, [rawRows]);

  const los = useMemo(()=> {
    if(rawRows.length>0){
      const buckets: Record<string, number> = {"1 notte":0, "2-3 notti":0, "4-6 notti":0, "7+ notti":0};
      rawRows.forEach(r=>{
        const v = Number.isFinite(r.los)? r.los : 0;
        if(v<=1) buckets["1 notte"]++;
        else if(v<=3) buckets["2-3 notti"]++;
        else if(v<=6) buckets["4-6 notti"]++;
        else buckets["7+ notti"]++;
      });
      return Object.entries(buckets).map(([bucket,value])=>({bucket, value}));
    }
    return [
      { bucket:"1 notte", value: 15 },
      { bucket:"2-3 notti", value: 46 },
      { bucket:"4-6 notti", value: 29 },
      { bucket:"7+ notti", value: 10 },
    ];
  }, [rawRows]);

  const channels = useMemo(()=> {
    if(rawRows.length>0){
      const counts: Record<string, number> = {};
      rawRows.forEach(r=>{ const k=(r.channel||"Altro")||"Altro"; counts[k]=(counts[k]||0)+1; });
      return Object.entries(counts).map(([channel,value])=>({channel,value}));
    }
    return [
      { channel:"Booking", value: 36 },
      { channel:"Airbnb", value: 26 },
      { channel:"Diretto", value: 22 },
      { channel:"Expedia", value: 11 },
      { channel:"Altro", value: 5 },
    ];
  }, [rawRows]);

  // Curva domanda
  const demand = useMemo(()=> (
    normalized.isBlocked ? [] : (rawRows.length>0
      ? calendarData.map(d=> ({ date: format(d.date, "d MMM", {locale:it}), value: d.pressure }))
      : normalized.safeDays.map(d=> ({ date: format(d, "d MMM", {locale:it}), value: pressureFor(d) + rand(-10,10) }))
    )
  ), [normalized.safeDays, normalized.isBlocked, calendarData, rawRows]);

  // ---------- UI ----------
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {notices.length>0 && (
        <div className="rounded-xl border p-3 bg-amber-50 text-amber-900 text-sm">
          <div className="font-medium mb-1">Avvisi</div>
          <ul className="list-disc ml-5">{notices.map((n,i)=> <li key={i}>{n}</li>)}</ul>
        </div>
      )}

      {normalized.isBlocked && (
        <div className="rounded-xl border p-3 bg-blue-50 text-blue-900 text-sm">
          <div className="font-medium">Inserisci una località valida per generare l'analisi</div>
          <div className="text-xs">Esempi: "Castiglion Fiorentino", "Arezzo", "Firenze", "Siena"</div>
        </div>
      )}

      {/* Pannello controlli */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sorgente dati */}
        <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
          <div className="text-sm font-semibold">Sorgente Dati</div>
          <div className="flex items-center gap-2">
            <label className="w-32 text-sm text-neutral-700">Tipo</label>
            <select className="h-9 rounded-xl border border-neutral-300 px-2 text-sm" value={dataSource} onChange={(e)=> setDataSource(e.target.value as any)}>
              <option value="none">Nessuna (demo)</option>
              <option value="csv">CSV URL</option>
              <option value="gsheet">Google Sheet</option>
            </select>
          </div>

          {dataSource === "csv" && (
            <div className="flex items-center gap-2">
              <label className="w-32 text-sm text-neutral-700">CSV URL</label>
              <input className="w-full h-9 rounded-xl border border-neutral-300 px-2 text-sm" value={csvUrl} onChange={e=> setCsvUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/.../gviz/tq?tqx=out:csv&sheet=Foglio1" />
            </div>
          )}

          {dataSource === "gsheet" && (
            <>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-neutral-700">Sheet ID</label>
                <input className="w-full h-9 rounded-xl border border-neutral-300 px-2 text-sm" value={gsId} onChange={e=> setGsId(e.target.value)} placeholder="1AbC…" />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-neutral-700">Nome foglio</label>
                <input className="w-full h-9 rounded-xl border border-neutral-300 px-2 text-sm" value={gsSheet} onChange={e=> setGsSheet(e.target.value)} placeholder="Foglio1 / Sheet1" />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-neutral-700">Sheet GID</label>
                <input className="w-full h-9 rounded-xl border border-neutral-300 px-2 text-sm" value={gsGid} onChange={e=> setGsGid(e.target.value)} placeholder="es. 0, 123456789 (da #gid=...)" />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-neutral-700">Modalità</label>
                <div className="flex items-center gap-2">
                  <input id="strict" type="checkbox" checked={strictSheet} onChange={(e)=> setStrictSheet(e.currentTarget.checked)} />
                  <label htmlFor="strict" className="text-sm">Rigida (consigliata)</label>
                </div>
              </div>
              {!strictSheet && (
                <div className="text-xs text-amber-700">
                  Modalità non rigida: Google potrebbe ignorare il nome foglio e restituire il primo foglio. Per selezione certa usa il GID.
                </div>
              )}
            </>
          )}

          {loading && <div className="text-xs text-neutral-600">Caricamento dati…</div>}
          {loadError && <div className="text-xs text-rose-600">Errore sorgente: {loadError}</div>}
          {rawRows.length>0 && <div className="text-xs text-emerald-700">Dati caricati: {rawRows.length} righe</div>}
        </div>

        {/* Località / Raggio / Mese / Tipologie */}
        <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3 lg:col-span-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5"/>
            <label className="w-32 text-sm text-neutral-700">Località</label>
            <input className="w-full h-9 rounded-xl border border-neutral-300 px-2 text-sm" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Città o indirizzo"/>
          </div>
          <div className="flex items-center gap-2">
            <Route className="h-5 w-5"/>
            <label className="w-32 text-sm text-neutral-700">Raggio</label>
            <select className="h-9 rounded-xl border border-neutral-300 px-2 text-sm w-40" value={String(radius)} onChange={(e)=> setRadius(parseInt(e.target.value))}>
              {RADIUS_OPTIONS.map(r=> <option key={r} value={r}>{r} km</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5"/>
            <label className="w-32 text-sm text-neutral-700">Mese</label>
            <input type="month" value={normalized.safeMonthISO ? normalized.safeMonthISO.slice(0,7) : ""} onChange={e=> setMonthISO(`${e.target.value||""}-01`)} className="w-48 h-9 rounded-xl border border-neutral-300 px-2 text-sm"/>
          </div>
          <div className="flex items-start gap-2">
            <label className="w-32 mt-1 text-sm text-neutral-700">Tipologie</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {STRUCTURE_TYPES.map(t=> (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={types.includes(t)} onChange={(ev)=>{
                    const c = ev.currentTarget.checked;
                    setTypes(prev=> c? Array.from(new Set([...prev, t])) : prev.filter(x=>x!==t));
                  }}/>
                  <span>{typeLabels[t]}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="w-32 text-sm text-neutral-700">Modalità</label>
            <div className="inline-flex rounded-xl border overflow-hidden">
              <button className={`px-3 py-1 text-sm ${mode==="zone"?"bg-neutral-900 text-white":"bg-white text-neutral-900"}`} onClick={()=> setMode("zone")}>Zona</button>
              <button className={`px-3 py-1 text-sm ${mode==="competitor"?"bg-neutral-900 text-white":"bg-white text-neutral-900"}`} onClick={()=> setMode("competitor")}>Competitor</button>
            </div>
            <button className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium border bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800 ml-auto" disabled={normalized.isBlocked} title={normalized.isBlocked?"Inserisci la località per procedere":"Genera Analisi"}>
              <RefreshCw className="h-4 w-4 mr-2"/>Genera Analisi
            </button>
          </div>
        </div>
      </div>

      {/* Mappa + Calendario */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border shadow-sm p-0 lg:col-span-2">
          {normalized.center ? (
            <LocationMap center={[normalized.center.lat, normalized.center.lng]} radius={normalized.safeR*1000} label={query || "Località"} />
          ) : (
            <div style={{height: 280}} className="flex items-center justify-center text-sm text-neutral-500">
              Inserisci una località valida per visualizzare la mappa e generare l'analisi
            </div>
          )}
        </div>
        <div className="bg-white rounded-2xl border shadow-sm p-6">
          <div className="text-lg font-semibold mb-2">Calendario Domanda + ADR – {format(monthDate, "LLLL yyyy", {locale: it})}</div>
          {normalized.isBlocked ? (
            <div className="text-sm text-neutral-500">Nessuna analisi disponibile: inserisci una località valida.</div>
          ) : (
            <CalendarHeatmap monthDate={monthDate} data={calendarData} />
          )}
        </div>
      </div>

      {/* Grafici */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border shadow-sm p-4">
          <div className="text-sm font-semibold mb-2">Provenienza Clienti</div>
          {Array.isArray(provenance) && provenance.length>0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={provenance} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                  {provenance.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={["#ef4444","#f59e0b","#10b981","#3b82f6","#8b5cf6"][index % 5]} />
                  ))}
                </Pie>
                <RTooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="text-xs text-neutral-500">Nessun dato</div>}
        </div>

        <div className="bg-white rounded-2xl border shadow-sm p-4">
          <div className="text-sm font-semibold mb-2">Durata Media Soggiorno (LOS)</div>
          {Array.isArray(los) && los.length>0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={los}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bucket" />
                <YAxis />
                <RTooltip />
                <Bar dataKey="value">
                  {los.map((_,i)=> <Cell key={i} fill={["#93c5fd","#60a5fa","#3b82f6","#1d4ed8"][i%4]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="text-xs text-neutral-500">Nessun dato</div>}
        </div>

        <div className="bg-white rounded-2xl border shadow-sm p-4">
          <div className="text-sm font-semibold mb-2">Canali di Vendita</div>
          {Array.isArray(channels) && channels.length>0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={channels}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="channel" />
                <YAxis />
                <RTooltip />
                <Bar dataKey="value">
                  {channels.map((_,i)=> <Cell key={i} fill={["#fdba74","#fb923c","#f97316","#ea580c","#c2410c"][i%5]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="text-xs text-neutral-500">Nessun dato</div>}
        </div>
      </div>

      <div className="bg-white rounded-2xl border shadow-sm p-4">
        <div className="text-sm font-semibold mb-2">Andamento Domanda – {format(monthDate, "LLLL yyyy", {locale: it})}</div>
        {normalized.isBlocked ? (
          <div className="text-sm text-neutral-500">In attesa di località valida…</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={demand}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{fontSize: 12}} interval={3}/>
              <YAxis />
              <RTooltip />
              <Line type="monotone" dataKey="value" stroke="#1e3a8a" strokeWidth={2} dot={{r:2}} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
