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

// Map dinamica (evita SSR)
const LocationMap = dynamic(()=> import("../../components/Map").then(m=>m.default), { ssr: false });

/* ----------------- Tema/Palette grafici ----------------- */
const THEME = {
  chart: {
    pie: { innerRadius: 60, outerRadius: 100, paddingAngle: 2, cornerRadius: 6 },
    bar: { margin: { top: 16, right: 16, left: 8, bottom: 16 }, tickSize: 12 },
    barWide: { margin: { top: 8, right: 16, left: 8, bottom: 24 }, tickSize: 12 },
    line: { stroke: "#2563eb", strokeWidth: 2, dotRadius: 3 }
  },
  palette: {
    barBlue: ["#60a5fa","#3b82f6","#2563eb","#1d4ed8","#1e40af"],
    barOrange: ["#fdba74","#fb923c","#f97316","#ea580c","#c2410c"],
  }
};
const solidColor = (i:number) => ["#ef4444","#22c55e","#3b82f6","#f59e0b","#8b5cf6","#06b6d4","#f43f5e"][i%7];
const shade = (hex:string, amt:number) => {
  // semplice shade hex: amt ±0.0..1.0
  const clamp=(n:number)=>Math.min(255,Math.max(0,n));
  const c = hex.replace("#","");
  const r = clamp(parseInt(c.substring(0,2),16)+Math.round(255*amt));
  const g = clamp(parseInt(c.substring(2,4),16)+Math.round(255*amt));
  const b = clamp(parseInt(c.substring(4,6),16)+Math.round(255*amt));
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
};

/* ----------------- Tipi ----------------- */
type Mode = "zone" | "competitor";

type CSVRow = Record<string, string>;
type WxByDate = Record<string, { code: number; tmin?: number; tmax?: number }>;

type SerpPoint = { dateLabel: string; value: number };
type ChannelRow = { channel: string; value: number };
type OriginRow = { name: string; value: number };
type LOSRow = { bucket: string; value: number };

type SerpDemandPayload = {
  ok: boolean;
  topic: string;
  geo: string;
  dateRange: string;
  cat: string;
  series: { date: string; score: number }[];
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
  villaggio_turistico:"Villaggi", resort:"Resort", "b&b":"B&B", affittacamere:"Affittacamere"
};

/* ----------------- Utils calendario ----------------- */
function daysOfMonthWindow(monthISO: string) {
  const base = monthISO ? parseISO(monthISO) : new Date();
  const from = startOfMonth(base);
  const to = endOfMonth(base);
  return eachDayOfInterval({ start: from, end: to });
}
function isWithinNextDays(date: Date, n: number) {
  const now = new Date();
  const diff = (date.getTime() - now.getTime()) / (1000*60*60*24);
  return diff >= 0 && diff <= n;
}

/* ----------------- Map helpers ----------------- */
function clampRadius(r: number) {
  if (r <= 10) return 10; if (r >= 30) return 30; return r;
}

/* ----------------- Local Storage helpers ----------------- */
function makeShareUrl(pathname: string, state: any) {
  const p = new URLSearchParams();
  if (state?.q) p.set("q", state.q);
  if (state?.r) p.set("r", String(state.r));
  if (state?.m) p.set("m", String(state.m).slice(0,7));
  if (Array.isArray(state?.t) && state.t.length) p.set("t", state.t.join(","));
  if (state?.mode) p.set("mode", state.mode);
  if (state?.dataSource && state.dataSource!=="none") p.set("src", state.dataSource);
  if (state?.csvUrl) p.set("csv", state.csvUrl);
  if (state?.gsId) p.set("gsid", state.gsId);
  if (state?.gsSheet) p.set("gss", state.gsSheet);
  if (state?.gsGid) p.set("gid", state.gsGid);
  if (state?.askTrend) p.set("trend", "1");
  if (state?.askChannels) p.set("ch", "1");
  if (state?.askProvenance) p.set("prov", "1");
  if (state?.askLOS) p.set("los", "1");
  if (state?.wxProvider) p.set("wx", state.wxProvider);
  return `${pathname}?${p.toString()}`;
}
function replaceUrlWithState(router: ReturnType<typeof useRouter>, pathname: string, state: any) {
  const next = makeShareUrl(pathname, state);
  router.replace(next);
}

/* ---------- Multi-select Tipologie (PAR1) ---------- */
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

  React.useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const toggle = (t: string) => {
    if (value.includes(t)) onChange(value.filter((x) => x !== t));
    else onChange([...value, t]);
  };
  const selectAll = () => onChange([...allTypes]);
  const clearAll = () => onChange([]);

  const summary =
    value.length === 0
      ? "Nessuna selezione"
      : value.length === allTypes.length
      ? "Tutte"
      : `${value.length} selezionate`;

  return (
    <div className="relative" ref={containerRef}>
      <span className="block text-sm font-medium text-neutral-700 mb-1">Tipologie</span>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-10 rounded-xl border border-neutral-300 px-3 text-sm flex items-center justify-between hover:border-neutral-400 transition bg-white"
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
                    className={`w-full flex items-center justify-between rounded-lg px-2 py-2 text-sm ${
                      active ? "bg-slate-50 border border-slate-200" : "hover:bg-neutral-50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {active ? <Check className="h-4 w-4" /> : <span className="inline-block h-4 w-4 rounded border" />}
                      <span>{labels[t] || t}</span>
                    </span>
                    <span className="text-xs text-neutral-500">{active ? "Selezionato" : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-2 flex items-center justify-between px-1">
            <button
              type="button"
              onClick={selectAll}
              className="text-xs rounded-md px-2 py-1 border bg-white hover:bg-neutral-50"
            >
              Seleziona tutte
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs rounded-md px-2 py-1 bg-slate-900 text-white hover:bg-slate-800"
            >
              Pulisci
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
/* ---------- Helpers (PAR1) - domanda/ADR demo ---------- */
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

/* ---------- Componenti UI locali ---------- */
const CalendarHeatmap = ({ monthDate, data }: { monthDate: Date; data: any[] }) => {
  const start = startOfMonth(monthDate);
  const end = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start, end });

  return (
    <div className="grid grid-cols-7 gap-2">
      {WEEKDAYS.map((w, i)=>(
        <div key={i} className="text-xs text-slate-500 text-center">{w}</div>
      ))}
      {days.map((d, i)=>{
        const rec = data.find(x=> format(x.date,"yyyy-MM-dd")===format(d,"yyyy-MM-dd"));
        const score = rec?.pressure ?? 0;
        const adr = rec?.adr ?? 0;
        const wx = rec?.wx;
        const col = score >= 120 ? "bg-rose-500" : score >= 100 ? "bg-rose-400" : score >= 85 ? "bg-orange-400" : score >= 70 ? "bg-yellow-300" : "bg-emerald-300";
        return (
          <div key={i} className="h-24 rounded-2xl border-2 border-white relative overflow-hidden">
            <div className={`absolute inset-0 ${col} opacity-30`} />
            <div className="absolute inset-x-0 top-0 h-1/2 bg-white px-2 flex items-center justify-between">
              <div className="text-xs font-medium">{format(d,"dd LLL", { locale: it })}</div>
              <div className="text-xs text-slate-500">ADR ~ €{adr}</div>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-white px-2 py-1">
              <div className="text-[11px] text-slate-700">Pressione: {score}</div>
              {rec?.holidayName && (
                <div className="text-[11px] text-rose-700">Festività: {rec.holidayName}</div>
              )}
              {wx && (
                <div className="flex items-center gap-1 text-[11px] text-slate-600 mt-0.5">
                  <WeatherIcon code={wx.code} className="w-4 h-4" />
                  <span>{codeToKind(wx.code)}</span>
                  {wx.tmin!=null && wx.tmax!=null && <span>· {Math.round(wx.tmin)}–{Math.round(wx.tmax)}°C</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ---------- Recharts tooltip (uniforme) ---------- */
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-white px-2 py-1 text-xs shadow-sm">
      <div className="font-medium">{label}</div>
      {payload.map((p: any, i:number)=>(
        <div key={i} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}: <b>{p.value}</b></span>
        </div>
      ))}
    </div>
  );
};

/* ----------------- Componente principale ----------------- */
export default function App(){
  const router = useRouter();
  const search = useSearchParams();

  // Stato UI (modificabile subito)
  const [query, setQuery] = useState<string>("Firenze");
  const [center, setCenter] = useState<{lat:number; lng:number} | null>({ lat: 43.7696, lng: 11.2558 });
  const [radius, setRadius] = useState<number>(20);
  const [monthISO, setMonthISO] = useState<string>(()=> {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
  });
  const [types, setTypes] = useState<string[]>(["hotel"]);
  const [mode, setMode] = useState<Mode>("zone");

  // Stato "applicato" (si aggiorna con "Genera Analisi")
  const [aQuery, setAQuery] = useState<string>("Firenze");
  const [aCenter, setACenter] = useState<{lat:number; lng:number} | null>({ lat: 43.7696, lng: 11.2558 });
  const [aRadius, setARadius] = useState<number>(20);
  const [aMonthISO, setAMonthISO] = useState<string>(()=> {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
  });
  const [aTypes, setATypes] = useState<string[]>(["hotel"]);
  const [aMode, setAMode] = useState<Mode>("zone");

  // SERP toggles
  const [askTrend, setAskTrend] = useState(true);
  const [askChannels, setAskChannels] = useState(false);
  const [askProvenance, setAskProvenance] = useState(false);
  const [askLOS, setAskLOS] = useState(false);

  // Meteo provider
  const [wxProvider, setWxProvider] = useState<"open-meteo"|"openweather">("open-meteo");

  // Notifiche
  const [notices, setNotices] = useState<string[]>([]);

  // SERP usage
  const [serpUsage, setSerpUsage] = useState<{ used?: number; total?: number; left?: number }>({});

  // Dati SERP
  const [serpTrend, setSerpTrend] = useState<SerpPoint[]>([]);
  const [serpChannels, setSerpChannels] = useState<ChannelRow[]>([]);
  const [serpOrigins, setSerpOrigins] = useState<OriginRow[]>([]);
  const [serpLOS, setSerpLOS] = useState<LOSRow[]>([]);

  // Meteo e Festività
  const [weatherByDate, setWeatherByDate] = useState<WxByDate>({});
  const [holidays, setHolidays] = useState<Record<string, string>>({});

  // Sorgente dati
  const [dataSource, setDataSource] = useState<"none"|"csv"|"gsheet">("none");
  const [csvUrl, setCsvUrl] = useState("");
  const [gsId, setGsId] = useState("");
  const [gsSheet, setGsSheet] = useState("");
  const [gsGid, setGsGid] = useState("");
  const [strictSheet, setStrictSheet] = useState(true);
  const [rawRows, setRawRows] = useState<CSVRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>("");

  // Share
  const [shareUrl, setShareUrl] = useState<string>("");

  /* ----------------- URL → Stato UI ----------------- */
  useEffect(() => {
    if (!search) return;
    const q = search.get("q") || "Firenze";
    const r = parseInt(search.get("r") || "20");
    const m = search.get("m") ? `${search.get("m")}-01` : "";
    const t = (search.get("t") || "hotel").split(",").filter(Boolean);
    const md: Mode = (search.get("mode") as Mode) || "zone";
    const wx = (search.get("wx") as "open-meteo"|"openweather") || "open-meteo";

    setQuery(q); setRadius(clampRadius(isNaN(r)?20:r)); if (m) setMonthISO(m); setTypes(t); setMode(md); setWxProvider(wx);

    // SERP
    setAskTrend(search.get("trend")==="1" ? true : true);
    setAskChannels(search.get("ch")==="1" ? true : false);
    setAskProvenance(search.get("prov")==="1" ? true : false);
    setAskLOS(search.get("los")==="1" ? true : false);

    // Sorgente
    const src = (search.get("src") as any) || "none";
    setDataSource(src);
    if (src==="csv") setCsvUrl(search.get("csv") || "");
    if (src==="gsheet") {
      setGsId(search.get("gsid") || ""); setGsSheet(search.get("gss") || ""); setGsGid(search.get("gid") || "");
    }
  }, [search]);
  /* ----------------- Ricerca località ----------------- */
  const handleSearchLocation = useCallback(async () => {
    try {
      if (!query || query.trim().length < 2) return;
      const r = await fetch(`/api/external/geocode?q=${encodeURIComponent(query)}`).then(r=>r.json());
      if (Array.isArray(r?.results) && r.results.length > 0) {
        const best = r.results[0];
        setCenter({ lat: best.lat, lng: best.lng });
        setNotices(prev => Array.from(new Set([...prev, `Centrata su ${best.label}`])));
      } else {
        setNotices(prev => Array.from(new Set([...prev, "Località non trovata."])));
      }
    } catch (e: any) {
      setNotices(prev => Array.from(new Set([...prev, `Errore geocode: ${String(e?.message||e)}`])));
    }
  }, [query]);

  const onMapClick = useCallback(async (latlng: {lat:number; lng:number}) => {
    try {
      setCenter(latlng);
      const r = await fetch(`/api/external/reverse-geocode?lat=${latlng.lat}&lng=${latlng.lng}`).then(r=>r.json());
      if (r?.label) setQuery(r.label);
    } catch {}
  }, []);

  /* ----------------- Genera Analisi → applica stato + fetch SERP ----------------- */
  const fetchSerp = useCallback(async () => {
    if (!aCenter) return;

    const needTrend   = askTrend;
    const needRelated = askChannels || askProvenance || askLOS;
    if (!needTrend && !needRelated) return;

    try {
      const params = new URLSearchParams({
        q: aQuery || "",
        lat: String(aCenter.lat), lng: String(aCenter.lng),
        parts: [needTrend?"trend":null, needRelated?"related":null].filter(Boolean).join(","),
        date: "today 12-m", cat: "203",
        ch: askChannels?"1":"0", prov: askProvenance?"1":"0", los: askLOS?"1":"0",
      });
      const r = await fetch(`/api/serp/demand?${params.toString()}`);
      const j: SerpDemandPayload = await r.json();

      if (!j?.ok) {
        setNotices(prev => Array.from(new Set([...prev, j?.error || "Nessun dato SERP per la query/periodo."])));
        return;
      }

      // Trend
      if (needTrend && Array.isArray(j.series)) {
        const month = aMonthISO ? parseISO(aMonthISO) : new Date();
        const start = startOfMonth(month); const end = endOfMonth(month);
        const inMonth = j.series.filter(s=>{
          const d = parseISO(s.date);
          return d>=start && d<=end;
        });
        const points: SerpPoint[] = inMonth.map(s=>({
          dateLabel: format(parseISO(s.date), "dd LLL", { locale: it }),
          value: s.score
        }));
        setSerpTrend(points);
      } else setSerpTrend([]);

      // Related
      if (needRelated && j.related) {
        const toCh = (arr?: any[]) => (arr || []).map(x=>({ channel: (x.label||"").replace(/^\w/, (m:string)=>m.toUpperCase()), value: x.value || 0 }));
        const toOr = (arr?: any[]) => (arr || []).map(x=>({ name: (x.label||"").replace(/^\w/, (m:string)=>m.toUpperCase()), value: x.value || 0 }));
        const toLo = (arr?: any[]) => (arr || []).map(x=>({ bucket: x.label, value: x.value || 0 }));
        setSerpChannels(toCh(j.related.channels));
        setSerpOrigins(toOr(j.related.provenance));
        setSerpLOS(toLo(j.related.los));
      } else {
        setSerpChannels([]); setSerpOrigins([]); setSerpLOS([]);
      }

      // Note
      if (j.note) setNotices(prev => Array.from(new Set([...prev, j.note!])));

      // Quota
      try {
        const q = await fetch("/api/serp/quota").then(r=>r.json());
        if (q?.ok) {
          const badge = {
            used:  j.usage?.this_month_usage ?? q.this_month_usage ?? q.raw?.this_month_usage,
            total: j.usage?.searches_per_month ?? q.searches_per_month ?? q.raw?.searches_per_month,
            left:  j.usage?.plan_searches_left ?? q.plan_searches_left ?? q.raw?.plan_searches_left
          };
          setSerpUsage(badge);
        }
      } catch {}
    } catch (e: any) {
      setNotices(prev => Array.from(new Set([...prev, `Errore SERP: ${String(e?.message||e)}`])));
    }
  }, [aCenter, aQuery, aMonthISO, askTrend, askChannels, askProvenance, askLOS]);

  /* ----------------- Dati esterni (meteo/festività) ----------------- */
  useEffect(() => {
    if (!aCenter || !aMonthISO) return;
    // Meteo
    (async ()=>{
      try {
        if (wxProvider==="open-meteo") {
          const u = `/api/external/weather?lat=${aCenter.lat}&lng=${aCenter.lng}`;
          const j = await fetch(u).then(r=>r.json());
          if (j?.ok && Array.isArray(j?.days)) {
            const map: WxByDate = {};
            (j.days as any[]).forEach(d=>{
              const key = String(d.date).slice(0,10);
              map[key] = { code: Number(d.code||0), tmin: d?.tmin, tmax: d?.tmax };
            });
            setWeatherByDate(map);
          } else setWeatherByDate({});
        } else {
          // OpenWeather (demo)
          setWeatherByDate({});
        }
      } catch { setWeatherByDate({}); }
    })();

    // Festività
    (async ()=>{
      try {
        const y = (aMonthISO||"").slice(0,4);
        const j = await fetch(`/api/external/holidays?year=${y||new Date().getFullYear()}`).then(r=>r.json());
        if (Array.isArray(j)) {
          const map: Record<string,string> = {};
          j.forEach((h:any)=> map[h.date]=h.name);
          setHolidays(map);
        } else setHolidays({});
      } catch { setHolidays({}); }
    })();
  }, [aCenter, aMonthISO, wxProvider]);

  // Derivazioni calendario (PAR1)
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
                    replaceUrlWithState(router, (typeof window !== "undefined" ? location.pathname : "/"), next);
                    const share = makeShareUrl((typeof window !== "undefined" ? location.pathname : "/"), next);
                    setShareUrl(share);
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
                    <RTooltip content={<CustomTooltip />} />
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
                    <RTooltip content={<CustomTooltip />} />
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
                  <RTooltip content={<CustomTooltip />} />
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
