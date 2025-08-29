"use client";

import React, { useMemo, useState, useEffect } from "react";
import Map from "/Users/luigipellegrini/Desktop/hotel-analytics-widget/components/Map.tsx";
import { PieChart, Pie, Cell, Tooltip as RTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, ResponsiveContainer, Legend } from "recharts";
import { CalendarDays, MapPin, Route, RefreshCw } from "lucide-react";
import { eachDayOfInterval, format, getDay, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { it } from "date-fns/locale";

// --- tipi ---
type LatLng = { lat: number; lng: number };
type DataRow = { date: Date|null; adr: number; occ: number; los: number; channel: string; provenance: string; type: string; lat: number; lng: number };
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
const typeLabels: Record<string,string> = { hotel:"Hotel", agriturismo:"Agriturismo", casa_vacanza:"Case Vacanza", villaggio_turistico:"Villaggi Turistici", resort:"Resort", "b&b":"B&B", affittacamere:"Affittacamere" };

// --- geocoding demo (blocca se invalida) ---
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

// --- util ---
function rand(min:number, max:number){ return Math.floor(Math.random()*(max-min+1))+min; }
function pressureFor(date: Date){
  const dow = getDay(date);
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

// --- calendario heatmap ---
function CalendarHeatmap({monthDate, data}:{monthDate: Date; data: {date: Date; pressure:number; adr:number}[]}){
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
        {["Lun","Mar","Mer","Gio","Ven","Sab","Dom"].map((w,i)=> <div key={i} className="py-1 font-medium">{w}</div>)}
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

// --- app ---
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

  function buildGSheetsCsvUrl(sheetId: string, sheetName: string){
    const id = (sheetId||"").trim();
    const name = encodeURIComponent(sheetName||"Sheet1");
    if(!id) return "";
    return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${name}`;
  }
  async function fetchCsv(url: string, signal?: AbortSignal): Promise<string>{
    const res = await fetch(url, { signal });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
  function parseCsv(text: string){
    const lines = text.split(/\r?\n/).filter(l=> l.trim().length>0);
    if(lines.length===0) return [];
    const headers = lines[0].split(",").map(h=> h.trim());
    return lines.slice(1).map(line=>{
      const cells = line.split(",");
      const row: any = {};
      headers.forEach((h,i)=> row[h] = (cells[i]??"").trim());
      return row;
    });
  }
  function toNumber(v: string, def=0){ const n = Number(v); return Number.isFinite(n)? n : def; }
  function toDate(v: string){ const d = new Date(v); return isNaN(d as any)? null : d; }
  function normalizeRows(rows: any[], warnings: string[]): DataRow[]{
    const out: DataRow[] = rows.map((r:any)=>{
      const date = toDate(r.date || r.Date || r.giorno || r.Giorno || r.data || r.Data || "");
      const adr = toNumber(r.adr || r.ADR || r.adr_medio || r.prezzo_medio);
      const occ = toNumber(r.occ || r.OCC || r.occupazione || r.occ_rate);
      const los = toNumber(r.los || r.LOS || r.notti || r.soggiorno);
      const channel = r.channel || r.canale || r.Channel || "";
      const provenance = r.provenance || r.country || r.nazione || "";
      const type = r.type || r.tipo || r.Tipo || "";
      const lat = toNumber(r.lat || r.latitude);
      const lng = toNumber(r.lng || r.longitude);
      return { date, adr, occ, los, channel, provenance, type, lat, lng };
    });
    const valid = out.filter(r=> !!r.date);
    if(valid.length===0) warnings.push("CSV caricato ma senza colonne riconosciute (es. 'date'): controlla l'intestazione");
    return valid;
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
        const url = dataSource === "csv" ? csvUrl : buildGSheetsCsvUrl(gsId, gsSheet);
        if(!url){ setLoadError("Sorgente dati mancante: specifica URL CSV o Google Sheet ID"); return; }
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
  }, [dataSource, csvUrl, gsId, gsSheet]);

  const monthDate = useMemo(()=> {
    if(normalized.isBlocked || !normalized.safeMonthISO) return new Date();
    try { return parseISO(normalized.safeMonthISO); } catch { return new Date(); }
  }, [normalized.safeMonthISO, normalized.isBlocked]);

  const calendarData = useMemo(()=> {
    if(normalized.isBlocked) return [];
    if(rawRows.length>0){
      const byDate = new Map<string, {date: Date; adrVals:number[]; pressVals:number[]}>();
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

  const demand = useMemo(()=> (
    normalized.isBlocked ? [] : (rawRows.length>0
      ? calendarData.map(d=> ({ date: format(d.date, "d MMM", {locale:it}), value: d.pressure }))
      : normalized.safeDays.map(d=> ({ date: format(d, "d MMM", {locale:it}), value: pressureFor(d) + rand(-10,10) }))
    )
  ), [normalized.safeDays, normalized.isBlocked, calendarData, rawRows]);

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

      {/* …resto layout e grafici come prima… */}
    </div>
  );
}

