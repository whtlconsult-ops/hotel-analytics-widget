"use client";

import React, { useState } from "react";
import Link from "next/link";

const TOPICS = [
  { value: "revenue", label: "Revenue / Tariffe" },
  { value: "marketing", label: "Marketing & OTA" },
  { value: "operations", label: "Operatività / Personale" },
  { value: "agriturismo", label: "Agriturismi / Extralberghiero" },
];

export default function RevenueAssistantPage() {
  const [message, setMessage] = useState("");
  const [topic, setTopic] = useState("revenue");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastPrompt, setLastPrompt] = useState("");

  async function handleAsk() {
    const trimmed = message.trim();
    if (!trimmed) return;

    // evita di ripagare la stessa domanda 3 volte
    if (trimmed === lastPrompt) return;

    setLoading(true);
    setAnswer("");
    try {
      const r = await fetch("/api/revenue-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          topic,
          context: {
            // qui un domani puoi passare dati veri dal widget
            source: "revenue-assistant-ui",
          },
        }),
      });
      const j = await r.json();
      if (j?.ok) {
        setAnswer(j.answer);
      } else {
        setAnswer(j?.error || "Nessuna risposta.");
      }
      setLastPrompt(trimmed);
    } catch (e: any) {
      setAnswer(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* topbar */}
      <div className="sticky top-0 z-[1100] border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 md:px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Modulo AI</div>
            <div className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              RevenueAssistant
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] border border-emerald-100">
                online
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              1 clic = 1 chiamata API. Nessuna chiamata automatica.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[12px] rounded-lg border px-3 py-2 bg-white hover:bg-slate-50"
            >
              ← Torna al widget
            </Link>
          </div>
        </div>
      </div>

      {/* body */}
      <div className="mx-auto max-w-6xl px-4 md:px-6 py-6 grid md:grid-cols-2 gap-6">
        {/* input */}
        <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700">Ambito</label>
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="mt-1 w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              {TOPICS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">La tua domanda</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="Es. Ho un 4* a Firenze, novembre è vuoto: che strategia di prezzo e canali mi consigli?"
            />
          </div>

          <button
            onClick={handleAsk}
            disabled={loading || !message.trim()}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${
              loading || !message.trim()
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {loading ? "Sto ragionando…" : "Chiedi a RevenueAssistant"}
          </button>

          <p className="text-[11px] text-slate-400">
            Suggerimento: specifica periodo, segmento (famiglie, business), canale e obiettivo di occupancy.
          </p>
        </div>

        {/* output */}
        <div className="bg-white rounded-2xl border shadow-sm p-4 min-h-[280px]">
          <div className="text-sm font-semibold text-slate-700 mb-2">Risposta</div>
          {answer ? (
            <div className="prose prose-sm max-w-none text-slate-800 whitespace-pre-wrap">
              {answer}
            </div>
          ) : (
            <div className="text-sm text-slate-400">
              Nessuna risposta ancora. Scrivi una domanda e premi “Chiedi a RevenueAssistant”.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
