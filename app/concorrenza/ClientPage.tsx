"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/* ---------------- Helpers ---------------- */

function useRecentList(key: string, max = 3) {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setItems(JSON.parse(raw));
    } catch {}
  }, [key]);
  const push = React.useCallback(
    (v: string) => {
      const s = (v || "").trim();
      if (!s) return;
      setItems((prev) => {
        const next = [s, ...prev.filter((x) => x !== s)].slice(0, max);
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [key, max]
  );
  return { items, push };
}

/* ------- very light formatter: puoi sostituire con il tuo layout ------- */
function formatRecon(j: any) {
  const lines: string[] = [];
  const prof = j?.profile || {};
  if (prof?.name || prof?.rating) {
    lines.push(
      `STRUTTURA: ${prof.name || "n.d."} — Rating ${
        prof.rating != null ? String(prof.rating) : "n.d."
      }`
    );
  }
  if (Array.isArray(prof.channels) && prof.channels.length) {
    lines.push(`CANALI: ${prof.channels.join(", ")}`);
  }
  if (Array.isArray(j?.adrMonthly) && j.adrMonthly.length === 12) {
    const mesi = [
      "Gen",
      "Feb",
      "Mar",
      "Apr",
      "Mag",
      "Giu",
      "Lug",
      "Ago",
      "Set",
      "Ott",
      "Nov",
      "Dic",
    ];
    lines.push("ADR STIMATO (€/notte):");
    lines.push("  " + mesi.join("  "));
    lines.push(
      "  " +
        j.adrMonthly
          .map((v: number) => String(v).padStart(3, " "))
          .join(" ")
    );
  }
  if (Array.isArray(j?.notes) && j.notes.length) {
    lines.push("NOTE: " + j.notes.join(" · "));
  }
  return lines.join("\n");
}

/* --------------- Component --------------- */

export default function ClientPage() {
  const sp = useSearchParams();
  const q0 = sp.get("q") || "";
  const loc0 = sp.get("loc") || "";
  const site0 = sp.get("site") || "";
  const be0 = sp.get("be") || "";

  // campi
  const [name, setName] = useState<string>(q0);
  const [site, setSite] = useState<string>(site0);
  const [beUrl, setBeUrl] = useState<string>(be0);
  const [loc, setLoc] = useState<string>(loc0);

  // recenti
  const recentName = useRecentList("recent_name", 3);
  const recentLoc = useRecentList("recent_loc", 3);
  const recentSite = useRecentList("recent_site", 3);
  const recentBe = useRecentList("recent_be", 3);

  // autosuggest località (debounce 300ms) + dedup compatibile ES5
  const [locSuggest, setLocSuggest] = useState<string[]>([]);
  useEffect(() => {
    const q = (loc || "").trim();
    if (q.length < 3) {
      setLocSuggest([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/external/geocode?q=${encodeURIComponent(q)}`,
          { signal: ac.signal, cache: "no-store" }
        );
        const j = await r.json();
        const arr: string[] = Array.isArray(j?.results)
          ? j.results
              .map((it: any) => it.formatted || it.label || it.name)
              .filter(Boolean)
          : Array.isArray(j)
          ? j.map((it: any) => it.display_name || it.name).filter(Boolean)
          : [];
        const uniq: string[] = [];
        for (let i = 0; i < arr.length; i++) {
          const v = arr[i];
          if (v && uniq.indexOf(v) === -1) uniq.push(v);
        }
        setLocSuggest(uniq.slice(0, 8));
      } catch {}
    }, 300);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [loc]);

  // Opzioni datalist località (deduplicate con recenti)
  const locOptions = useMemo(() => {
    const arr = [...locSuggest, ...recentLoc.items];
    const uniq: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v && uniq.indexOf(v) === -1) uniq.push(v);
    }
    return uniq.slice(0, 8);
  }, [locSuggest, recentLoc.items]);

  // abilita CTA se ho almeno un campo
  const canRecon = useMemo(() => {
    return (
      (name && name.trim().length > 0) ||
      (site && site.trim().length > 0) ||
      (beUrl && beUrl.trim().length > 0) ||
      (loc && loc.trim().length > 0)
    );
  }, [name, site, beUrl, loc]);

  // stato analisi
  const [loadingRecon, setLoadingRecon] = useState(false);
  const [recon, setRecon] = useState<any>(null); // { ok: boolean, ... }

  // chiamata backend recon
  async function doRecon() {
    try {
      setLoadingRecon(true);
      const p = new URLSearchParams();
      if (name && name.trim()) p.set("name", name.trim());
      if (loc && loc.trim()) p.set("loc", loc.trim());
      if (site && site.trim()) p.set("site", site.trim());
      if (beUrl && beUrl.trim()) p.set("be", beUrl.trim());

      const r = await fetch(`/api/competitors/recon?${p.toString()}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!j?.ok) {
        setRecon({ ok: false, error: j?.error || "Analisi non disponibile." });
      } else {
        setRecon(j);
      }
    } catch (e: any) {
      setRecon({ ok: false, error: String(e?.message || e) });
    } finally {
      setLoadingRecon(false);
    }
  }

  // suggest competitors
  type CompItem = {
    title: string;
    address?: string;
    rating?: number;
    reviews?: number;
    coords?: { lat: number; lng: number };
    phone?: string;
    url?: string;
  };
  const [suggest, setSuggest] = useState<CompItem[]>([]);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<Record<number, boolean>>({});

  async function doSuggest() {
    try {
      setLoadingSuggest(true);
      setSuggest([]);
      setSelectedIdx({});
      const p = new URLSearchParams();
      if (name && name.trim()) p.set("name", name.trim());
      if (loc && loc.trim()) p.set("loc", loc.trim());
      const r = await fetch(`/api/competitors/suggest?${p.toString()}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (Array.isArray(j?.items)) setSuggest(j.items);
    } catch {}
    finally {
      setLoadingSuggest(false);
    }
  }

  async function analyzeSelected() {
    const picks: CompItem[] = [];
    for (let i = 0; i < suggest.length; i++) {
      if (selectedIdx[i]) picks.push(suggest[i]);
    }
    if (picks.length === 0) return;
    const first = picks[0];
    setName(first.title || name);
    if (first.address) setLoc(first.address);
    await doRecon();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* topbar */}
      <div className="sticky top-0 z-[1100] border-b bg-white backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="text-sm font-semibold">Esame della concorrenza</div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[12px] rounded-lg border px-3 py-2 bg-white hover:bg-slate-50"
            >
              Torna all’analisi
            </Link>
          </div>
        </div>
      </div>

      {/* content */}
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 space-y-6">
        {/* Form */}
        <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center md:items-end">
            {/* Struttura */}
            <div className="relative">
              <label className="block text-sm font-medium text-slate-700">
                Struttura
              </label>
              <input
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="inserisci nome pubblico struttura"
                list="recent-names"
              />
              <datalist id="recent-names">
                {recentName.items.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>

            {/* Sito ufficiale */}
            <div className="relative">
              <label className="block text-sm font-medium text-slate-700">
                Sito ufficiale (opz.)
              </label>
              <input
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm"
                value={site}
                onChange={(e) => setSite(e.target.value)}
                placeholder="https://…"
                list="recent-sites"
              />
              <datalist id="recent-sites">
                {recentSite.items.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>

            {/* Booking / Prenota URL */}
            <div className="relative">
              <label className="block text-sm font-medium text-slate-700">
                URL Booking / Prenota (opz.)
              </label>
              <input
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm"
                value={beUrl}
                onChange={(e) => setBeUrl(e.target.value)}
                placeholder="https://be…"
                list="recent-be"
              />
              <datalist id="recent-be">
                {recentBe.items.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>

            {/* Località */}
            <div className="relative">
              <label className="block text-sm font-medium text-slate-700">
                Località
              </label>
              <input
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-sm"
                value={loc}
                onChange={(e) => setLoc(e.target.value)}
                placeholder="inserisci località"
                list="loc-suggest"
              />
              <datalist id="loc-suggest">
                {locOptions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>

            {/* CTA */}
            <div className="pt-6">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white px-3 py-2 hover:bg-slate-800 disabled:opacity-50"
                disabled={!canRecon || loadingRecon}
                onClick={() => {
                  recentName.push(name.trim());
                  recentLoc.push(loc.trim());
                  if (site.trim()) recentSite.push(site.trim());
                  if (beUrl.trim()) recentBe.push(beUrl.trim());
                  doRecon();
                }}
              >
                {loadingRecon ? "Analisi in corso…" : "Genera analisi"}
              </button>
            </div>
          </div>

          {!canRecon && (
            <p className="text-xs text-slate-500">
              Inserisci almeno uno tra “Struttura”, “Sito”, “Booking URL” o
              “Località”.
            </p>
          )}
        </section>

        {/* Risultati */}
        <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
          <div className="text-sm font-semibold">Risultato</div>

          {loadingRecon && (
            <div className="text-sm text-slate-600">Elaborazione in corso…</div>
          )}

          {!loadingRecon && recon && !recon.ok && (
            <div className="text-sm text-red-600">
              {recon.error || "Analisi non disponibile."}
            </div>
          )}

          {!loadingRecon && recon && recon.ok && (
            <div className="text-sm text-slate-700 whitespace-pre-wrap">
              {formatRecon(recon)}
            </div>
          )}
        </section>

        {/* SUGGERISCI COMPETITOR */}
        <section className="bg-white rounded-2xl border shadow-sm p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Suggerisci competitor</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
                onClick={doSuggest}
                disabled={loadingSuggest || (!name && !loc)}
                title="Inserisci almeno Struttura o Località"
              >
                {loadingSuggest ? "Ricerca…" : "Suggerisci competitor"}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white px-3 py-2 hover:bg-slate-800 disabled:opacity-50"
                onClick={analyzeSelected}
                disabled={
                  loadingRecon ||
                  Object.keys(selectedIdx).filter((k) => selectedIdx[Number(k)])
                    .length === 0
                }
                title="Analizza il primo competitor selezionato"
              >
                {loadingRecon ? "Analisi…" : "Analizza selezionati"}
              </button>
            </div>
          </div>

          {suggest.length === 0 && !loadingSuggest && (
            <p className="text-xs text-slate-500">
              Nessun suggerimento ancora. Inserisci almeno Struttura o Località
              e premi “Suggerisci competitor”.
            </p>
          )}

          {suggest.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {suggest.map((c, i) => (
                <label
                  key={`${c.title}-${i}`}
                  className="flex items-start gap-3 rounded-xl border p-3 hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!selectedIdx[i]}
                    onChange={(e) =>
                      setSelectedIdx((prev) => ({
                        ...prev,
                        [i]: e.target.checked,
                      }))
                    }
                  />
                  <div className="text-sm">
                    <div className="font-medium">{c.title}</div>
                    {c.rating != null && (
                      <div className="text-xs text-slate-600">
                        Rating {c.rating}{" "}
                        {c.reviews ? `(${c.reviews})` : ""}
                      </div>
                    )}
                    {c.address && (
                      <div className="text-xs text-slate-600">{c.address}</div>
                    )}
                    {c.url && (
                      <div className="text-xs text-blue-600 underline">
                        <a href={c.url} target="_blank" rel="noreferrer">
                          Sito
                        </a>
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
