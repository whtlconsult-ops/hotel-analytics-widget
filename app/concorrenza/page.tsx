"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Search, TrendingUp, Users } from "lucide-react";

type ReconProfile = {
  name: string;
  address?: string;
  coords?: { lat: number; lng: number };
  category?: string;
  rating?: number;
  reviews?: number;
  channels?: string[];
  amenities?: string[];
  roomHints?: string[];
};

type ReconResponse = {
  ok: boolean;
  profile?: ReconProfile;
  adrMonthly?: number[]; // 12 valori
  notes?: string[];
  error?: string;
};

type SuggestItem = {
  name: string;
  address?: string;
  rating?: number;
  distanceKm?: number;
  category?: string;
};

export default function PageConcorrenza() {
  const sp = useSearchParams();
  const q0 = decodeURIComponent(sp.get("q") || "");
  const loc0 = decodeURIComponent(sp.get("loc") || "");

  const [name, setName] = useState(q0);
  const [loc, setLoc] = useState(loc0);
  const [site, setSite] = useState("");

  const [loadingRecon, setLoadingRecon] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [loadingCompare, setLoadingCompare] = useState(false);

  const [recon, setRecon] = useState<ReconResponse | null>(null);
  const [suggest, setSuggest] = useState<SuggestItem[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [compareText, setCompareText] = useState<string>("");

  const hasSelection = useMemo(
    () => Object.values(selected).some(Boolean),
    [selected]
  );

  async function doRecon() {
    setLoadingRecon(true);
    setCompareText("");
    try {
      const p = new URLSearchParams();
      if (name) p.set("name", name);
      if (loc) p.set("loc", loc);
      if (site) p.set("site", site);
      const r = await fetch(`/api/competitors/recon?${p.toString()}`);
      const j = (await r.json()) as ReconResponse;
      setRecon(j);
    } catch (e: any) {
      setRecon({ ok: false, error: String(e?.message || e) });
    } finally {
      setLoadingRecon(false);
    }
  }

  async function doSuggest() {
    setLoadingSuggest(true);
    setCompareText("");
    try {
      const p = new URLSearchParams();
      if (loc) p.set("loc", loc);
      // tipologia opzionale: per ora deduciamo da nome se contiene B&B/agriturismo
      if (/b&b|bnb|agritur|agri/i.test(name)) p.set("type", "bnb");
      const r = await fetch(`/api/competitors/suggest?${p.toString()}`);
      const j = await r.json();
      const items: SuggestItem[] = Array.isArray(j?.items) ? j.items : [];
      setSuggest(items.slice(0, 8));
      setSelected({});
    } catch {
      setSuggest([]);
    } finally {
      setLoadingSuggest(false);
    }
  }

  async function doCompare() {
    setLoadingCompare(true);
    try {
      const chosen = suggest.filter((_, i) => selected[i]);
      const reports: Array<{ title: string; adr?: number[]; rating?: number }> = [];

      // Primo: struttura principale (se già analizzata)
      if (recon?.ok && recon.profile?.name) {
        reports.push({
          title: `${recon.profile.name} (rating ${recon.profile.rating ?? "n.d."})`,
          adr: recon.adrMonthly,
          rating: recon.profile.rating,
        });
      }

      // Poi: ricon per ciascun competitor selezionato
      for (const c of chosen) {
        const p = new URLSearchParams();
        p.set("name", c.name);
        if (c.address) p.set("loc", c.address);
        const rr = await fetch(`/api/competitors/recon?${p.toString()}`);
        const jj = (await rr.json()) as ReconResponse;
        reports.push({
          title: `${c.name} (rating ${c.rating ?? "n.d."})`,
          adr: jj?.adrMonthly,
          rating: c.rating,
        });
      }

      // Monta report
      const months = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
      let out = "=== CONFRONTO ADR STIMATO (€/notte) ===\n\n";
      // intestazione
      out += "Struttura".padEnd(32) + months.map(m=>m.padStart(5)).join(" ") + "\n";
      out += "-".repeat(32 + months.length*6) + "\n";
      for (const r of reports) {
        const row = (r.adr && r.adr.length===12 ? r.adr : new Array(12).fill(0));
        out += (r.title || "").slice(0,30).padEnd(32) +
          row.map(v => (v>0? String(Math.round(v)).padStart(5) : "   - ")).join(" ") + "\n";
      }

      // differenziale medio vs prima struttura (se disponibile)
      if (reports.length > 1 && reports[0].adr) {
        const base = reports[0].adr!;
        out += "\nDifferenziale medio vs prima struttura:\n";
        for (let i=1;i<reports.length;i++) {
          const r = reports[i];
          if (!r.adr) continue;
          const diff = r.adr.reduce((a,v,idx)=> a + (v - base[idx]), 0) / 12;
          const pct  = base.reduce((a,v)=>a+v,0)/12;
          const pDif = pct>0 ? Math.round((diff/pct)*100) : 0;
          out += `- ${r.title}: ${Math.round(diff)} €  (${pDif>=0?"+":""}${pDif}%)\n`;
        }
      }

      setCompareText(out);
    } catch (e: any) {
      setCompareText(String(e?.message || e));
    } finally {
      setLoadingCompare(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* topbar */}
      <div className="sticky top-0 z-[1100] border-b bg-white backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="inline-flex items-center gap-2 text-[12px] rounded-lg border px-3 py-2 bg-white hover:bg-slate-50">
              <ArrowLeft className="h-4 w-4" /> Torna all’analisi
            </Link>
            <h1 className="text-base md:text-lg font-semibold tracking-tight">Esame della concorrenza</h1>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 space-y-6">
        {/* Form */}
        <section className="bg-white rounded-2xl border shadow-sm p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Struttura</label>
              <input className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm"
                placeholder="Es. Hotel ABC"
                value={name} onChange={e=>setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Località</label>
              <input className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm"
                placeholder="Es. Firenze"
                value={loc} onChange={e=>setLoc(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Sito ufficiale (opz.)</label>
              <input className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm"
                placeholder="https://..."
                value={site} onChange={e=>setSite(e.target.value)} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={doRecon}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white ${loadingRecon ? "bg-slate-400" : "bg-slate-900 hover:bg-slate-800"}`}
              disabled={loadingRecon}
            >
              <Search className="h-4 w-4" /> Genera analisi
            </button>
            <button
              onClick={doSuggest}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white ${loadingSuggest ? "bg-indigo-400" : "bg-indigo-600 hover:bg-indigo-500"}`}
              disabled={loadingSuggest}
            >
              <Users className="h-4 w-4" /> Suggerisci competitor
            </button>
            <button
              onClick={doCompare}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white ${!hasSelection || loadingCompare ? "bg-emerald-300" : "bg-emerald-600 hover:bg-emerald-500"}`}
              disabled={!hasSelection || loadingCompare}
            >
              <TrendingUp className="h-4 w-4" /> Confronta selezionati
            </button>
          </div>
        </section>

        {/* Profilo struttura */}
        <section className="bg-white rounded-2xl border shadow-sm p-4 md:p-5">
          <div className="text-sm font-semibold mb-3">Profilo struttura</div>
          {!recon ? (
            <div className="text-sm text-slate-500">Nessuna analisi ancora eseguita.</div>
          ) : !recon.ok ? (
            <div className="text-sm text-rose-600">Errore: {recon.error || "impossibile completare l'analisi"}</div>
          ) : (
            <pre className="text-[12px] leading-5 whitespace-pre-wrap">
{renderProfile(recon)}
            </pre>
          )}
        </section>

        {/* Suggeriti */}
        <section className="bg-white rounded-2xl border shadow-sm p-4 md:p-5">
          <div className="text-sm font-semibold mb-3">Competitor suggeriti</div>
          {suggest.length === 0 ? (
            <div className="text-sm text-slate-500">Nessun suggerimento ancora disponibile.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {suggest.map((c, i) => (
                <div key={i} className="rounded-xl border p-3">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={!!selected[i]}
                      onChange={e => setSelected(s => ({ ...s, [i]: e.target.checked }))}
                    />
                    <div>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-slate-600">
                        {c.category ? `${c.category} · ` : ""}{c.rating ? `Rating ${c.rating}` : "Rating n.d."}
                        {c.distanceKm!=null ? ` · ${c.distanceKm.toFixed(1)} km` : ""}
                      </div>
                      {c.address && <div className="text-xs text-slate-600 mt-0.5">{c.address}</div>}
                    </div>
                  </label>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Confronto */}
        <section className="bg-white rounded-2xl border shadow-sm p-4 md:p-5">
          <div className="text-sm font-semibold mb-3">Confronto selezionati</div>
          {!compareText ? (
            <div className="text-sm text-slate-500">Seleziona almeno un competitor e premi “Confronta selezionati”.</div>
          ) : (
            <pre className="text-[12px] leading-5 whitespace-pre">{compareText}</pre>
          )}
        </section>
      </div>
    </div>
  );
}

function renderProfile(r: ReconResponse) {
  if (!r?.profile) return "Nessun profilo disponibile.";
  const p = r.profile;
  const adr = Array.isArray(r.adrMonthly) ? r.adrMonthly : [];
  const months = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

  const lines: string[] = [];
  lines.push(`STRUTTURA: ${p.name}${p.category ? " ("+p.category+")" : ""} — Rating ${p.rating ?? "n.d."}${p.reviews ? " ("+p.reviews+" recensioni)" : ""}`);
  if (p.address) lines.push(`INDIRIZZO: ${p.address}`);
  if (p.channels?.length) lines.push(`CANALI: ${p.channels.join(", ")}`);
  if (p.amenities?.length) lines.push(`SERVIZI: ${p.amenities.slice(0,10).join(" · ")}`);
  if (p.roomHints?.length) lines.push(`ROOM TYPES (hint): ${p.roomHints.slice(0,6).join(" · ")}`);

  if (adr.length === 12) {
    lines.push("ADR STIMATO (€/notte):");
    lines.push("  " + months.map(m=>m.padStart(4)).join(" "));
    lines.push("  " + adr.map(v => String(Math.round(v)).padStart(4)).join(" "));
    lines.push("NOTE: Stima su stagionalità locale + fattori di qualità (fonte: SERP/Maps; fallback se quota assente).");
  } else {
    lines.push("ADR STIMATO: n.d.");
  }

  if (r.notes?.length) lines.push("NOTE: " + r.notes.join(" · "));
  return lines.join("\n");
}
