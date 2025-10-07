"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList
} from "recharts";

/* ──────────────────────────────────────────────────────────
   Tipi
─────────────────────────────────────────────────────────── */
type ChannelRow = { channel: string; value: number };
type OriginRow  = { name: string; value: number };
type LOSRow     = { bucket: string; value: number };

/* ──────────────────────────────────────────────────────────
   Palette + utility visual
─────────────────────────────────────────────────────────── */
const PALETTE = {
  blue:   "#2563eb",
  indigo: "#4f46e5",
  teal:   "#0d9488",
  amber:  "#f59e0b",
  rose:   "#f43f5e",
  slate:  "#64748b",
  slateDark: "#475569",
};

const CHANNEL_COLORS: Record<string,string> = {
  "Booking.com": PALETTE.indigo,
  "Diretto":     PALETTE.teal,
  "Expedia":     PALETTE.blue,
  "Airbnb":      PALETTE.rose,
  "Altro":       PALETTE.slate,
};

const ORIGIN_COLORS = [
  PALETTE.blue, PALETTE.indigo, PALETTE.teal, PALETTE.amber, PALETTE.rose, PALETTE.slate
];

// Etichetta % sulle fette del donut (niente label per spicchi <6%)
const RAD = Math.PI / 180;
const pieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  const r = innerRadius + (outerRadius - innerRadius) * 0.62;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  const v = Math.round((percent || 0) * 100);
  if (v < 6) return null;
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
      fill="#0f172a"
    >
      {v}%
    </text>
  );
};

const fmtPct  = (v:number) => `${Math.round(v)}%`;
const fmtInt  = (v:number) => new Intl.NumberFormat("it-IT").format(Math.round(v));
const sumBy   = <T,>(arr:T[], sel:(x:T)=>number)=> arr.reduce((a,x)=>a+(Number(sel(x))||0),0);

/* ──────────────────────────────────────────────────────────
   Fallback “plausibile” quando SERP non risponde
─────────────────────────────────────────────────────────── */
function monthIndexFromParam(m?: string | null): number {
  if (!m) return new Date().getMonth();
  const s = String(m);
  const mm = s.length >= 7 ? Number(s.slice(5,7)) - 1 : new Date().getMonth();
  return Number.isFinite(mm) ? Math.min(11, Math.max(0, mm)) : new Date().getMonth();
}
function classifyCity(city: string) {
  const s = (city||"").toLowerCase();
  const urban = ["roma","rome","milano","milan","firenze","florence","venezia","venice","napoli","naples","bologna","torino","turin","verona","genova","pisa","siena"];
  const sea   = ["rimini","riccione","viareggio","taormina","alghero","cagliari","olbia","gallipoli","sorrento","positano","ostuni"];
  const mountain = ["madonna di campiglio","cortina","cortina d'ampezzo","bormio","livigno","ortisei","selva","val gardena","canazei","alpe di siusi","brunico","folgarida","courmayeur"];
  if (urban.some(x => s.includes(x))) return "urban";
  if (sea.some(x => s.includes(x))) return "sea";
  if (mountain.some(x => s.includes(x))) return "mountain";
  return "generic";
}
function lerp(a:number,b:number,t:number){ return a+(b-a)*t; }

function baseChannelsForType(types: string[]): Record<string, number> {
  const has = (t: string) => types.some(x => (x||"").toLowerCase().includes(t));
  let booking=45, diretto=25, expedia=15, airbnb=10, altro=5;        // hotel default
  if (has("b&b") || has("bnb") || has("appart")) {                   // B&B / appartamenti
    booking=30; diretto=20; expedia=5; airbnb=40; altro=5;
  }
  if (has("agritur")) {                                              // agriturismo
    booking=20; diretto=45; expedia=5; airbnb=20; altro=10;
  }
  return { booking, diretto, expedia, airbnb, altro };
}
function adjustChannels(ctx: "urban"|"sea"|"mountain"|"generic", mIdx:number, ch: Record<string,number>) {
  const summer = (mIdx>=5 && mIdx<=8) ? 1 : 0; // giu-set
  if (ctx==="sea") {
    ch.expedia = Math.round(lerp(ch.expedia, ch.expedia+8, summer));
    ch.airbnb  = Math.round(lerp(ch.airbnb,  ch.airbnb +6, summer));
  }
  if (ctx==="mountain") {
    const winter = (mIdx===11 || mIdx===0 || mIdx===1) ? 1 : 0; // dic-gen-feb
    ch.booking = Math.round(lerp(ch.booking, ch.booking+6, winter));
    ch.diretto = Math.round(lerp(ch.diretto, ch.diretto+4, winter));
  }
  if (ctx==="urban") {
    ch.diretto = Math.round(lerp(ch.diretto, ch.diretto+6, (1-summer)*0.6));
  }
  // normalizza a 100
  const tot = ch.booking+ch.diretto+ch.expedia+ch.airbnb+ch.altro;
  Object.keys(ch).forEach(k => (ch as any)[k] = Math.round((ch as any)[k]*100/tot));
  return ch;
}
function syntheticOrigins(city:string, mIdx:number): OriginRow[] {
  let it=45, de=12, fr=10, uk=15, us=18;
  const ctx = classifyCity(city);
  if (ctx==="sea" || ctx==="mountain") { it = 52; de=14; fr=10; uk=12; us=12; }
  if (mIdx>=5 && mIdx<=8) { it -= 6; uk += 4; us += 4; de += 2; }
  else if (mIdx===11 || mIdx===0) { it += 4; de += 1; fr += 1; }
  const altro = Math.max(0, 100 - (it+de+fr+uk+us));
  return [
    { name: "Italia",  value: it },
    { name: "Germania",value: de },
    { name: "Francia", value: fr },
    { name: "UK",      value: uk },
    { name: "USA",     value: us },
    { name: "Altro",   value: altro },
  ];
}
function syntheticLOS(city:string, mIdx:number): LOSRow[] {
  const ctx = classifyCity(city);
  let n1=40, n23=35, n46=15, n7=10; // urbana
  if (ctx==="sea" && (mIdx>=5 && mIdx<=8)) { n1=18; n23=32; n46=30; n7=20; }
  if (ctx==="mountain" && (mIdx===11 || mIdx===0 || mIdx===1)) { n1=22; n23=30; n46=28; n7=20; }
  const tot = n1+n23+n46+n7;
  return [
    { bucket: "1 notte",    value: Math.round(n1*100/tot) },
    { bucket: "2-3 notti",  value: Math.round(n23*100/tot) },
    { bucket: "4-6 notti",  value: Math.round(n46*100/tot) },
    { bucket: "7+ notti",   value: Math.round(n7*100/tot) },
  ];
}
function syntheticChannels(types: string[]|null|undefined, city:string, mIdx:number): ChannelRow[] {
  const base = baseChannelsForType(types || []);
  const adj  = adjustChannels(classifyCity(city), mIdx, base);
  return [
    { channel: "Booking.com", value: adj.booking },
    { channel: "Diretto",     value: adj.diretto },
    { channel: "Expedia",     value: adj.expedia },
    { channel: "Airbnb",      value: adj.airbnb },
    { channel: "Altro",       value: adj.altro },
  ];
}

/* ──────────────────────────────────────────────────────────
   Component
─────────────────────────────────────────────────────────── */
export default function App2() {
  const search = useSearchParams();
  const q     = decodeURIComponent(search.get("q") || "Firenze");
  const ch    = search.get("ch") === "1";
  const prov  = search.get("prov") === "1";
  const losF  = search.get("los") === "1";
  const m     = search.get("m") || undefined;
  const mIdx  = monthIndexFromParam(m);
  const types = (search.get("t") || "").split(",").filter(Boolean);

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [origins, setOrigins]   = useState<OriginRow[]>([]);
  const [los, setLOS]           = useState<LOSRow[]>([]);
  const [notes, setNotes]       = useState<string[]>([]);

  // Fetch SERP related -> fallback se non arriva o è zero
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          q, parts: "related", date: "today 12-m", cat: "203",
          ch: ch ? "1" : "0", prov: prov ? "1" : "0", los: losF ? "1" : "0",
        });
        let rel: any = null;
        try {
          const r = await fetch(`/api/serp/demand?${params.toString()}`);
          const j = await r.json();
          if (j?.ok && j.related) rel = j.related;
        } catch { /* ignore */ }

        const emptyOrZero = (arr:any[]) => !Array.isArray(arr) || arr.length===0 || arr.every(x => (x?.value||0)===0);

        if (!rel || (
          (!ch   || emptyOrZero(rel.channels))   &&
          (!prov || emptyOrZero(rel.provenance)) &&
          (!losF || emptyOrZero(rel.los))
        )) {
          // Fallback dimostrativo
          if (ch && !cancelled)   setChannels(syntheticChannels(types, q, mIdx));
          if (prov && !cancelled) setOrigins(syntheticOrigins(q, mIdx));
          if (losF && !cancelled) setLOS(syntheticLOS(q, mIdx));
          if (!cancelled) setNotes(p => Array.from(new Set([...p, "Dati dimostrativi (SERP non disponibile)."])));
          return;
        }

        if (ch && Array.isArray(rel.channels) && !cancelled) {
          setChannels(rel.channels.map((x:any)=>({ channel: String(x.label||"").replace(/^\w/, m=>m.toUpperCase()), value: Number(x.value)||0 })));
        }
        if (prov && Array.isArray(rel.provenance) && !cancelled) {
          setOrigins(rel.provenance.map((x:any)=>({ name: String(x.label||"").replace(/^\w/, m=>m.toUpperCase()), value: Number(x.value)||0 })));
        }
        if (losF && Array.isArray(rel.los) && !cancelled) {
          setLOS(rel.los.map((x:any)=>({ bucket: String(x.label||""), value: Number(x.value)||0 })));
        }
      } catch (e:any) {
        if (!cancelled) setNotes(p => Array.from(new Set([...p, String(e?.message || e)])));
      }
    })();
    return () => { cancelled = true; };
  }, [q, ch, prov, losF, mIdx, types.join(",")]);

  const sortedChannels = useMemo(() => [...channels].sort((a,b)=> b.value - a.value), [channels]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/?q=${encodeURIComponent(q)}&r=${encodeURIComponent(search.get("r") || "20")}&m=${encodeURIComponent(m || "")}&t=${encodeURIComponent(search.get("t") || "hotel")}&mode=${encodeURIComponent(search.get("mode") || "zone")}&wx=${encodeURIComponent(search.get("wx") || "open-meteo")}&trend=${encodeURIComponent(search.get("trend") || "1")}&ch=${encodeURIComponent(search.get("ch") || "1")}&prov=${encodeURIComponent(search.get("prov") || "1")}&los=${encodeURIComponent(search.get("los") || "1")}`}
            className="inline-flex items-center gap-2 text-[12px] rounded-lg border px-3 py-2 bg-white hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> Torna all’analisi
          </Link>
          <h1 className="text-base md:text-lg font-semibold tracking-tight">Grafica — {q}</h1>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 md:px-6 pb-10">
        {notes.length>0 && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-3 text-[12px] text-amber-900">
            {notes.join(" · ")}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Canali di vendita */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 md:p-5">
            <div className="mb-3">
              <h3 className="text-[12px] font-semibold">Canali di vendita</h3>
              <div className="text-[11px] text-slate-600 mt-0.5">Ripartizione % canali</div>
            </div>
            <div className="h-[260px] md:h-[300px]">
              {sortedChannels.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-500">Nessun dato disponibile</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sortedChannels}
                    layout="vertical"
                    margin={{ top: 8, right: 24, bottom: 8, left: 24 }}
                    barCategoryGap={12}
                  >
                    <defs>
                      {sortedChannels.map((c, i) => (
                        <linearGradient id={`gradCh${i}`} key={i} x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%"  stopColor={CHANNEL_COLORS[c.channel] || PALETTE.slate} stopOpacity={0.95}/>
                          <stop offset="100%" stopColor={CHANNEL_COLORS[c.channel] || PALETTE.slateDark} stopOpacity={0.9}/>
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={fmtPct} tick={{ fontSize: 11, fill: "#475569" }} />
                    <YAxis type="category" dataKey="channel" width={110} tick={{ fontSize: 11, fill: "#475569" }} />
                    <RTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const p = payload[0];
                        return (
                          <div className="rounded-lg border bg-white shadow px-2.5 py-1.5 text-[12px]">
                            <div className="font-medium">{p?.payload?.channel}</div>
                            <div className="text-slate-600">{fmtPct(Number(p.value||0))}</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="value" radius={[10,10,10,10]}>
                      {sortedChannels.map((c, idx) => (
                        <Cell key={idx} fill={`url(#gradCh${idx})`} />
                      ))}
                      <LabelList dataKey="value" position="right" formatter={fmtPct} style={{ fontSize: 11, fill: "#334155" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* Provenienza clienti */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 md:p-5">
            <div className="mb-3">
              <h3 className="text-[12px] font-semibold">Provenienza clienti</h3>
              <div className="text-[11px] text-slate-600 mt-0.5">Composizione % per mercato</div>
            </div>
            <div className="h-[260px] md:h-[300px]">
              {origins.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-500">Nessun dato disponibile</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
  <PieChart margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
    <RTooltip
      content={({ active, payload }) => {
        if (!active || !payload || !payload.length) return null;
        const p = payload[0];
        return (
          <div className="rounded-lg border bg-white shadow px-2.5 py-1.5 text-[12px]">
            <div className="font-medium">{p?.payload?.name}</div>
            <div className="text-slate-600">{`${Math.round(Number(p.value || 0))}%`}</div>
          </div>
        );
      }}
    />
    <Legend wrapperStyle={{ fontSize: 11, color: "#475569" }} />
    <Pie
      data={origins}
      dataKey="value"
      nameKey="name"
      innerRadius="58%"
      outerRadius="82%"
      paddingAngle={3}
      labelLine={false}
      label={pieLabel}
      isAnimationActive
    >
      {origins.map((o, i) => (
        <Cell
          key={o.name}
          fill={ORIGIN_COLORS[i % ORIGIN_COLORS.length]} // colori PIENI
          stroke="#ffffff"                              // separatore pulito
          strokeWidth={2}
        />
      ))}
    </Pie>
  </PieChart>
</ResponsiveContainer>
              )}
            </div>
          </section>

          {/* LOS */}
          <section className="bg-white rounded-2xl border shadow-sm p-4 md:p-5">
            <div className="mb-3">
              <h3 className="text-[12px] font-semibold">Lunghezza del soggiorno (LOS)</h3>
              <div className="text-[11px] text-slate-600 mt-0.5">Distribuzione % soggiorni</div>
            </div>
            <div className="h-[260px] md:h-[300px]">
              {los.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-500">Nessun dato disponibile</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={los}
                    margin={{ top: 12, right: 24, bottom: 8, left: 8 }}
                    barCategoryGap={18}
                  >
                    <defs>
                      <linearGradient id="gradLos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"  stopColor={PALETTE.indigo} stopOpacity={0.95}/>
                        <stop offset="100%" stopColor={PALETTE.blue}   stopOpacity={0.9}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#475569" }} />
                    <YAxis domain={[0, 100]} tickFormatter={fmtPct} tick={{ fontSize: 11, fill: "#475569" }} />
                    <RTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const p = payload[0];
                        return (
                          <div className="rounded-lg border bg-white shadow px-2.5 py-1.5 text-[12px]">
                            <div className="font-medium">{p?.payload?.bucket}</div>
                            <div className="text-slate-600">{fmtPct(Number(p.value||0))}</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="value" fill="url(#gradLos)" radius={[10,10,0,0]} isAnimationActive>
                      <LabelList dataKey="value" position="top" formatter={fmtPct} style={{ fontSize: 11, fill: "#334155" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
