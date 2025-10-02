"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";

import {
  format, parseISO, addDays,
  startOfMonth, endOfMonth
} from "date-fns";
import { it } from "date-fns/locale";

import {
  ResponsiveContainer,
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip as RTooltip,
  BarChart, Bar
} from "recharts";

// Mappa (client only)
const LocationMap = dynamic(() => import("../../components/Map"), { ssr: false });

// ------ Tipi
type Mode = "zone" | "competitor";

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

type DataRow = Record<string, any>;

type Normalized = {
  warnings: string[];
  safeMonthISO: string; // YYYY-MM
  safeDays: Date[];
  center: { lat: number; lng: number } | null;
  safeR: number;
  safeT: string[];
  isBlocked: boolean;
};

// ------ Costanti
const STRUCTURE_TYPES = ["hotel","aparthotel","resort","agriturismo","b&b","ostello"] as const;

// ------ Helper URL/state
function parseNumParam(v: string | null, fallback: number) {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function parseListParam(v: string | null) {
  if (!v) return [];
  return v.split(",").map(s => s.trim()).filter(Boolean);
}
function clampRadiusSilently(r: number) {
  if (!Number.isFinite(r)) return 20;
  if (r < 10) return 10;
  if (r > 30) return 30;
  return Math.round(r);
}
function safeParseMonthISO(m: string, warnings: string[]): string {
  const ok = /^\d{4}-\d{2}$/.test(m);
  if (!ok) {
    const now = new Date();
    const fix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    warnings.push("Mese non valido: ripristinato al corrente.");
    return fix;
  }
  return m;
}
function daysOfMonthWindow(monthISO: string): Date[] {
  const s = startOfMonth(parseISO(`${monthISO}-01`));
  const e = endOfMonth(parseISO(`${monthISO}-01`));
  const out: Date[] = [];
  let d = s;
  while (d <= e) { out.push(d); d = addDays(d, 1); }
  return out;
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
function colorForPressure(v: number) {
  // scala blu indaco chiara → scura (coerente con PAR1)
  const a = Math.max(0, Math.min(100, v));
  const t = a / 100;
  const from = [239, 246, 255];  // indigo-50
  const to   = [ 67,  56, 202];  // indigo-700
  const c = from.map((f, i) => Math.round(f + (to[i]-f)*t));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}
function adrFromPressure(p: number, mode: Mode) {
  const baseMin = 80, baseMax = 140;
  const est = baseMin + (p/100) * (baseMax - baseMin);
  return Math.round(mode === "competitor" ? est * 1.10 : est);
}

// Share URL
function makeShareUrl(
  pathname: string,
  opts: { q: string; r: number; m: string; t: string[]; mode: Mode; dataSource: "none"|"csv"|"gsheet"; csvUrl: string; gsId: string; gsGid: string; gsSheet: string;
    askTrend:boolean; askChannels:boolean; askProvenance:boolean; askLOS:boolean; wxProvider:string; }
) {
  const params = new URLSearchParams();
  params.set("q", opts.q);
  params.set("r", String(opts.r));
  params.set("m", opts.m); // YYYY-MM
  if (opts.t?.length) params.set("t", opts.t.join(","));
  params.set("mode", opts.mode);
  if (opts.dataSource !== "none") {
    params.set("src", opts.dataSource);
    if (opts.dataSource === "csv" && opts.csvUrl) params.set("csv", opts.csvUrl);
    if (opts.dataSource === "gsheet" && opts.gsId) {
      params.set("id", opts.gsId);
      if (opts.gsGid) params.set("gid", opts.gsGid);
      if (opts.gsSheet) params.set("sheet", opts.gsSheet);
    }
  }
  if (!opts.askTrend) params.set("trend","0"); else params.set("trend","1");
  if (opts.askChannels)   params.set("ch","1");
  if (opts.askProvenance) params.set("prov","1");
  if (opts.askLOS)        params.set("los","1");
  params.set("wx", opts.wxProvider);
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
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`; // YYYY-MM
  });
  // Default: SOLO Hotel
  const [types, setTypes] = useState<string[]>(["hotel"]);

  // Meteo provider
  const [wxProvider, setWxProvider] = useState<"open-meteo"|"openweather">("open-meteo");

  // Selettori SERP (uno per grafico)
  const [askTrend, setAskTrend] = useState(true);            // Andamento domanda
  const [askChannels, setAskChannels] = useState(false);     // Canali
  const [askProvenance, setAskProvenance] = useState(false); // Provenienza
  const [askLOS, setAskLOS] = useState(false);               // LOS

  // Dati esterni (placeholder compatibilità PAR1)
  const [dataSource, setDataSource] = useState<"none"|"csv"|"gsheet">("none");
  const [csvUrl, setCsvUrl] = useState("");
  const [gsId, setGsId] = useState("");
  const [gsSheet, setGsSheet] = useState("Sheet1");
  const [gsGid, setGsGid] = useState("");
  const [strictSheet] = useState(true);

  // Caricamenti CSV/GSheet (compat)
  const [rawRows] = useState<DataRow[]>([]);
  const [loading] = useState(false);
  const [loadError] = useState<string | null>(null);

  // Festività + Meteo
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [weatherByDate, setWeatherByDate] = useState<Record<string, { t?: number; p?: number; code?: number }>>({});

  // Stato “applicato”
  const [aQuery, setAQuery] = useState(query);
  const [aRadius, setARadius] = useState(radius);
  const [aMonthISO, setAMonthISO] = useState(monthISO); // YYYY-MM
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

  // Flag cambi (per bottone Applica ecc.)
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
    const safeMonthISO = safeParseMonthISO(aMonthISO, warnings); // YYYY-MM
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
    const m = search.get("m") ?? monthISO; // YYYY-MM
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
      // === COSTRUZIONE PARAMETRI RICHIESTA ===
      const params = new URLSearchParams();

      // query: imponi "<q> hotel"
      params.set("q", `${aQuery} hotel`);

      // geo
      params.set("lat", String(aCenter.lat));
      params.set("lng", String(aCenter.lng));

      // categoria Travel
      params.set("cat", "203");

      // parti richieste (trend sempre se spuntato; related se serve)
      params.set("parts", [
        needTrend ? "trend" : "",
        needRelated ? "related" : ""
      ].filter(Boolean).join(","));

      // timeframe coerente con il MESE selezionato nel calendario
      const monthStart = format(startOfMonth(parseISO(`${aMonthISO}-01`)), "yyyy-MM-dd");
      const monthEnd   = format(endOfMonth(parseISO(`${aMonthISO}-01`)),  "yyyy-MM-dd");
      params.set("date", `${monthStart} ${monthEnd}`);

      // bucket related (solo se richiesti)
      if (askChannels)    params.set("ch", "1");
      if (askProvenance)  params.set("prov", "1");
      if (askLOS)         params.set("los", "1");

      // === FINE COSTRUZIONE PARAMETRI ===

      const r = await fetch(`/api/serp/demand?${params.toString()}`);
      const j: SerpDemandPayload = await r.json();

      if (!j?.ok) {
        setNotices(prev => Array.from(new Set([
          ...prev,
          (j as any)?.error || "Errore richiesta SERP: uso dati dimostrativi."
        ])));
        return;
      }

      // Quota SERP (parziale dalla stessa response)
      let badge: { used?: number; total?: number; left?: number } = {
        used:  j.usage?.this_month_usage,
        total: j.usage?.searches_per_month,
        left:  j.usage?.plan_searches_left
      };

      // Serie per il grafico (ricampionata sul mese corrente)
      if (needTrend && Array.isArray(j.series)) {
        setSerpTrend(resampleToDays(j.series, aMonthISO));
      } else if (!needTrend) {
        setSerpTrend([]);
      }

      // Related (canali, provenienza, LOS)
      if (needRelated && j.related) {
        const rel = j.related;

        if (askChannels) {
          setSerpChannels([
            { channel: "Booking",  value: rel.channels.find((x:any)=>x.label==="booking")?.value || 0 },
            { channel: "Airbnb",   value: rel.channels.find((x:any)=>x.label==="airbnb")?.value || 0 },
            { channel: "Diretto",  value: rel.channels.find((x:any)=>x.label==="diretto")?.value || 0 },
            { channel: "Expedia",  value: rel.channels.find((x:any)=>x.label==="expedia")?.value || 0 },
            { channel: "Altro",    value: rel.channels.find((x:any)=>x.label==="altro")?.value || 0 },
          ]);
        } else {
          setSerpChannels([]);
        }

        if (askProvenance) {
          setSerpOrigins([
            { name: "Italia",   value: rel.provenance.find((x:any)=>x.label==="italia")?.value || 0 },
            { name: "Germania", value: rel.provenance.find((x:any)=>x.label==="germania")?.value || 0 },
            { name: "Francia",  value: rel.provenance.find((x:any)=>x.label==="francia")?.value || 0 },
            { name: "USA",      value: rel.provenance.find((x:any)=>x.label==="usa")?.value || 0 },
            { name: "UK",       value: rel.provenance.find((x:any)=>x.label==="uk")?.value || 0 },
          ]);
        } else {
          setSerpOrigins([]);
        }

        if (askLOS) {
          setSerpLOS([
            { bucket: "1 notte",   value: rel.los.find((x:any)=>x.label==="1 notte")?.value || 0 },
            { bucket: "2-3 notti", value: rel.los.find((x:any)=>x.label==="2-3 notti")?.value || 0 },
            { bucket: "4-6 notti", value: rel.los.find((x:any)=>x.label==="4-6 notti")?.value || 0 },
            { bucket: "7+ notti",  value: rel.los.find((x:any)=>x.label==="7+ notti")?.value || 0 },
          ]);
        } else {
          setSerpLOS([]);
        }
      }

      if (j.note) {
        setNotices(prev => Array.from(new Set([...prev, j.note!])));
      }

      // Merge badge con /api/serp/quota
      try {
        const qq = await fetch("/api/serp/quota").then(r=>r.json());
        if (qq?.ok) {
          badge.used  = badge.used  ?? qq.this_month_usage;
          badge.total = badge.total ?? (qq.searches_per_month ?? qq.raw?.searches_per_month);
          badge.left  = badge.left  ?? (qq.plan_searches_left ?? qq.raw?.plan_searches_left);
        }
      } catch {
        // ignora, badge resta quello parziale
      }
      setSerpUsage(badge);

    } catch {
      setNotices(prev => Array.from(new Set([
        ...prev,
        "Errore richiesta SERP: uso dati dimostrativi."
      ])));
    }
  }, [
    aQuery, aCenter, aMonthISO,
    askTrend, askChannels, askProvenance, askLOS
  ]);

  useEffect(() => { fetchSerp(); }, [fetchSerp]);
  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Topbar */}
      <div className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="text-sm md:text-base font-semibold text-slate-800">
            Analisi domanda · <span className="text-indigo-700">{aQuery}</span>
          </div>
          <div className="flex items-center gap-3">
            {serpUsage && (
              <span className="text-xs rounded-md px-2 py-1 border bg-slate-100">
                SERP {serpUsage.used ?? "?"}/{serpUsage.total ?? "?"} · left {serpUsage.left ?? "?"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 grid md:grid-cols-12 gap-6">
        {/* Left panel */}
        <div className="md:col-span-4 space-y-4">
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-3">Filtri</div>
            <label className="text-xs text-slate-600">Località</label>
            <div className="flex gap-2 mt-1">
              <input
                value={query} onChange={e=>setQuery(e.currentTarget.value)}
                className="flex-1 h-9 rounded-md border px-2"
                placeholder="Città o indirizzo"
              />
              <button onClick={handleSearchLocation} className="h-9 px-3 rounded-md bg-indigo-600 text-white">Cerca</button>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className="text-xs text-slate-600">Raggio</label>
                <select value={radius} onChange={e=>setRadius(parseInt(e.currentTarget.value))}
                        className="w-full h-9 rounded-md border px-2 mt-1">
                  <option value={10}>10 km</option>
                  <option value={20}>20 km</option>
                  <option value={30}>30 km</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-600">Mese</label>
                <input
                  type="month"
                  value={monthISO}
                  onChange={e=>setMonthISO(e.currentTarget.value)}
                  className="w-full h-9 rounded-md border px-2 mt-1"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="text-xs text-slate-600">Tipologie</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {STRUCTURE_TYPES.map(t => {
                  const on = types.includes(t);
                  return (
                    <button key={t}
                      onClick={()=>{
                        setTypes(on ? types.filter(x=>x!==t) : [...types, t]);
                      }}
                      className={`h-8 px-3 rounded-full border text-xs ${on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white"}`}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              <label className="text-xs text-slate-600">Modalità</label>
              <div className="flex gap-2 mt-2">
                <button
                  className={`h-8 px-3 rounded-md border text-xs ${aMode==='zone'?'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}
                  onClick={()=>setMode('zone')}
                >Zona</button>
                <button
                  className={`h-8 px-3 rounded-md border text-xs ${aMode==='competitor'?'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}
                  onClick={()=>setMode('competitor')}
                >Competitor</button>
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                Zona = baseline macro domanda; Competitor = stessa curva ma ADR più “aggressivo”.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-600">Meteo</label>
                <select value={wxProvider} onChange={e=>setWxProvider(e.currentTarget.value as any)}
                        className="w-full h-9 rounded-md border px-2 mt-1">
                  <option value="open-meteo">Open-Meteo</option>
                  <option value="openweather">OpenWeather</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-600">Selettori API</label>
                <div className="flex flex-col gap-2 mt-1">
                  <label className="text-[12px]"><input type="checkbox" checked={askTrend} onChange={e=>setAskTrend(e.currentTarget.checked)} /> Andamento</label>
                  <label className="text-[12px]"><input type="checkbox" checked={askChannels} onChange={e=>setAskChannels(e.currentTarget.checked)} /> Canali</label>
                  <label className="text-[12px]"><input type="checkbox" checked={askProvenance} onChange={e=>setAskProvenance(e.currentTarget.checked)} /> Provenienza</label>
                  <label className="text-[12px]"><input type="checkbox" checked={askLOS} onChange={e=>setAskLOS(e.currentTarget.checked)} /> LOS</label>
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={()=>{
                  setAQuery(query); setARadius(radius); setAMonthISO(monthISO); setATypes(types); setAMode(mode);
                  replaceUrlWithState(router, (typeof window !== "undefined" ? location.pathname : "/"),
                    { q: query, r: radius, m: monthISO, t: types, mode, dataSource, csvUrl, gsId, gsGid, gsSheet, askTrend, askChannels, askProvenance, askLOS, wxProvider });
                }}
                className="h-9 px-4 rounded-md bg-indigo-600 text-white"
              >Genera analisi</button>
              <button
                onClick={()=>{
                  const now = new Date();
                  const defM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
                  setQuery("Firenze"); setRadius(20); setMonthISO(defM); setTypes(["hotel"]); setMode("zone");
                  setAskTrend(true); setAskChannels(false); setAskProvenance(false); setAskLOS(false); setWxProvider("open-meteo");
                }}
                className="h-9 px-4 rounded-md border"
              >Reset</button>
            </div>
          </div>

          {/* Mappa */}
          <div className="bg-white rounded-2xl border shadow-sm p-0 overflow-hidden">
            <div className="h-[360px]">
              <LocationMap
                center={aCenter}
                radius={aRadius * 1000}     // metri
                label={`${aRadius} km`}
                onClick={onMapClick}
              />
            </div>
          </div>

          {/* Avvisi */}
          {notices.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-3 text-xs">
              {Array.from(new Set(notices)).map((n,i)=>(<div key={i} className="mb-1 last:mb-0">• {n}</div>))}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="md:col-span-8 space-y-4">
          {/* Calendario domanda (PAR1) */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="mb-2 text-sm font-semibold">
              Calendario — {format(parseISO(`${aMonthISO}-01`), "MMMM yyyy", { locale: it })}
            </div>

            {/* Header giorni settimana */}
            <div className="grid grid-cols-7 gap-1 text-[11px] text-slate-500 mb-1">
              {["Lun","Mar","Mer","Gio","Ven","Sab","Dom"].map(d => <div key={d} className="text-center">{d}</div>)}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {daysOfMonthWindow(aMonthISO).map((d, idx) => {
                const iso = format(d, "yyyy-MM-dd");
                const trendPoint = serpTrend[idx] ? serpTrend[idx].value : 0; // già ricampionata
                const bg = colorForPressure(trendPoint);
                const adr = adrFromPressure(trendPoint, aMode);

                return (
                  <div key={iso} className="rounded-md p-2 text-xs border"
                       style={{ backgroundColor: bg, borderColor: "rgba(0,0,0,0.05)" }}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{format(d,"d")}</span>
                      <span className="text-[11px]">€{adr}</span>
                    </div>
                    {/* Meteo/icone: solo prossimi 7 giorni */}
                    {isWithinNextDays(d, 7) && weatherByDate[iso] && (
                      <div className="mt-1 text-[11px]">
                        <span className="opacity-80">{Math.round(weatherByDate[iso]?.t ?? 0)}°</span>
                        {typeof weatherByDate[iso]?.p === "number" && <span className="ml-1 opacity-60">{Math.round(weatherByDate[iso]!.p!)}mm</span>}
                      </div>
                    )}
                    {/* Festività IT */}
                    {holidays[iso] && <div className="mt-1 text-[10px] italic opacity-80">{holidays[iso]}</div>}
                  </div>
                );
              })}
            </div>
          </div>
          {/* Andamento domanda (linea/area) */}
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="mb-2 text-sm font-semibold">
              Andamento domanda — {format(parseISO(`${aMonthISO}-01`), "MMMM yyyy", { locale: it })}
            </div>

            {(!serpTrend.length || serpTrend.every(p=>!p.value)) ? (
              <div className="h-64 grid place-items-center text-sm text-slate-500">
                Nessun segnale utile per questo periodo/area.
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={serpTrend}>
                    <defs>
                      <linearGradient id="fillTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1e3a8a" stopOpacity={0.25}/>
                        <stop offset="100%" stopColor="#1e3a8a" stopOpacity={0.05}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="dateLabel" />
                    <YAxis domain={[0,100]} ticks={[0,33,66,100]} />
                    <RTooltip />
                    <Area type="monotone" dataKey="value" stroke="#1e3a8a" strokeWidth={1.6} fill="url(#fillTrend)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Segmenti — Canali */}
          {askChannels && (
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="mb-2 text-sm font-semibold">Canali</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serpChannels}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="channel" />
                    <YAxis allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="value" fill="#4f46e5" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Segmenti — Provenienza */}
          {askProvenance && (
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="mb-2 text-sm font-semibold">Provenienza</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serpOrigins}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="value" fill="#4f46e5" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Segmenti — LOS */}
          {askLOS && (
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="mb-2 text-sm font-semibold">Lunghezza soggiorno (LOS)</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serpLOS}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" />
                    <YAxis allowDecimals={false} />
                    <RTooltip />
                    <Bar dataKey="value" fill="#4f46e5" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
