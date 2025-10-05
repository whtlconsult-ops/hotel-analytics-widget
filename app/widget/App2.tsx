"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Legend, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";

type ChannelRow = { channel: string; value: number };
type OriginRow  = { name: string; value: number };
type LOSRow     = { bucket: string; value: number };

const COLORS = ["#ef4444","#f59e0b","#10b981","#3b82f6","#8b5cf6","#22c55e","#06b6d4","#f43f5e"];

export default function App2(){
  const search = useSearchParams();

const q = search.get("q") || "Firenze";
const hasCh   = search.has("ch");
const hasProv = search.has("prov");
const hasLos  = search.has("los");
const noneSelected = !hasCh && !hasProv && !hasLos;

const ch   = noneSelected ? true : search.get("ch") === "1";
const prov = noneSelected ? true : search.get("prov") === "1";
const losF = noneSelected ? true : search.get("los") === "1";

  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [origins,  setOrigins]  = useState<OriginRow[]>([]);
  const [los,      setLOS]      = useState<LOSRow[]>([]);
  const [notes,    setNotes]    = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        // Chiediamo solo i RELATED: canali/provenienza/los (in base ai toggle passati)
        const params = new URLSearchParams({
          q, parts: "related", date: "today 12-m", cat: "203",
          ch: ch ? "1" : "0",
          prov: prov ? "1" : "0",
          los: losF ? "1" : "0",
        });
        const r = await fetch(`/api/serp/demand?${params.toString()}`);
        const j = await r.json();
        if (!j?.ok || !j.related) { setNotes(p=>[...p,"Nessun related disponibile"]); return; }

        const rel = j.related || {};
        if (ch && Array.isArray(rel.channels)) {
          setChannels(rel.channels.map((x:any)=>({
            channel: String(x.label||"").replace(/^\w/, m=>m.toUpperCase()),
            value: Number(x.value)||0
          })));
        }
        if (prov && Array.isArray(rel.provenance)) {
          setOrigins(rel.provenance.map((x:any)=>({
            name: String(x.label||"").replace(/^\w/, m=>m.toUpperCase()),
            value: Number(x.value)||0
          })));
        }
        if (losF && Array.isArray(rel.los)) {
          setLOS(rel.los.map((x:any)=>({ bucket: x.label, value: Number(x.value)||0 })));
        }
      } catch (e:any) {
        setNotes(p=>[...p, String(e?.message||e)]);
      }
    })();
  }, [q, ch, prov, losF]);

  const backHref = useMemo(() => {
  // Ricostruisce la query string in modo sicuro
  const entries = Array.from(search.entries());
  const qs = entries.map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return "/" + (qs ? `?${qs}` : "");
}, [search]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Grafica – Dati correlati</h1>
          <a href={backHref} className="px-3 py-2 text-sm rounded-lg bg-white border hover:bg-slate-50">⬅ Torna all’Analisi</a>
        </div>

        {notes.length>0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-sm text-amber-900">
            {notes.join(" · ")}
          </div>
        )}

        {/* Provenienza */}
        {prov && (
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Provenienza Clienti</div>
            {origins.length === 0 || origins.every(x => (x.value || 0) === 0) ? (
              <div className="h-56 flex items-center justify-center text-sm text-slate-500">Nessun segnale utile.</div>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <PieChart>
                  <Pie data={origins} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={110} paddingAngle={2} cornerRadius={6} labelLine={false}
                    label={({ percent }) => `${Math.round((percent || 0) * 100)}%`}>
                    {origins.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]} stroke="#fff" strokeWidth={2}/>)}
                  </Pie>
                  <RTooltip />
                  <Legend verticalAlign="bottom" iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* LOS */}
        {losF && (
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Durata Media Soggiorno (LOS)</div>
            {los.length === 0 || los.every(x => (x.value || 0) === 0) ? (
              <div className="h-48 flex items-center justify-center text-sm text-slate-500">Nessun segnale utile.</div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={los} margin={{ top: 16, right: 16, left: 8, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" radius={[8,8,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* Canali */}
        {ch && (
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="text-sm font-semibold mb-2">Canali di Vendita</div>
            {channels.length === 0 || channels.every(x => (x.value || 0) === 0) ? (
              <div className="h-56 flex items-center justify-center text-sm text-slate-500">Nessun segnale utile.</div>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={channels} margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="channel" interval={0} height={40} />
                  <YAxis />
                  <RTooltip />
                  <Bar dataKey="value" radius={[8,8,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
