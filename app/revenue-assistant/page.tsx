"use client";

import React, { useState } from "react";

export default function RevenueAssistantPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState<"revenue" | "marketing" | "operations">("revenue");
  const [extraContext, setExtraContext] = useState("");
  // cronologia locale (non persiste al refresh)
  const [turns, setTurns] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);

  const handleAsk = async () => {
  if (!question.trim()) return;
  setLoading(true);

  try {
    const res = await fetch("/api/revenue-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: question,
        topic,
        context: extraContext,
        previous: turns.slice(-6),
      }),
    });

    const j = await res.json();
    const txt: string = j?.answer || "Nessuna risposta utile.";

    setAnswer(txt);
    setTurns((prev): Array<{ role: "user" | "assistant"; content: string }> => {
      const next: Array<{ role: "user" | "assistant"; content: string }> = [
        ...prev,
        { role: "user", content: question },
        { role: "assistant", content: txt },
      ];
      return next.slice(-8);
    });

    setQuestion("");
  } catch (e) {
    setAnswer("Errore nella chiamata all'AI.");
  } finally {
    setLoading(false);
  }
};

  return (
    <div className="min-h-screen bg-slate-50">
      {/* topbar semplice */}
      <div className="sticky top-0 z-[1100] border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 md:px-6 py-4 flex items-center justify-between">
          <h1 className="text-base font-semibold text-slate-900">
            RevenueAssistant <span className="text-xs font-normal text-slate-500">beta</span>
          </h1>
          <a
            href="/"
            className="text-xs rounded-lg border px-3 py-1.5 bg-white hover:bg-slate-50"
          >
            Torna al widget
          </a>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 md:px-6 py-6 space-y-6">
        {/* riga input */}
        <div className="grid gap-4 md:grid-cols-[1.5fr,0.9fr]">
          <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <label className="text-sm font-semibold text-slate-700">
              La tua domanda
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
              placeholder="Es. Crea una strategia tariffaria per un hotel 4* a Firenze per il ponte del 25 aprile..."
            />
            <div className="flex gap-2">
              <button
                onClick={handleAsk}
                disabled={loading}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${
                  loading
                    ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                    : "bg-emerald-600 text-white hover:bg-emerald-500"
                }`}
              >
                {loading ? "In esecuzione…" : "Chiedi a RevenueAssistant"}
              </button>
              <select
                value={topic}
                onChange={(e) =>
                  setTopic(e.target.value as "revenue" | "marketing" | "operations")
                }
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="revenue">Revenue</option>
                <option value="marketing">Marketing</option>
                <option value="operations">Operations</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
            <label className="text-sm font-semibold text-slate-700">
              Contesto (facoltativo)
            </label>
            <textarea
              value={extraContext}
              onChange={(e) => setExtraContext(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-300"
              placeholder="Es. 42 camere, ADR medio 165€, occupazione media 68%, canali Booking+direct, target leisure + gruppi weekend…"
            />
            <p className="text-xs text-slate-400">
              Più contesto → risposte più vicine al tuo hotel.
            </p>
          </div>
        </div>

        {/* output */}
        <div className="bg-white rounded-2xl border shadow-sm p-4 min-h-[280px]">
          <div className="text-sm font-semibold text-slate-700 mb-2">Risposta</div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              RevenueAssistant sta ragionando…
            </div>
          ) : answer ? (
            <div className="prose prose-sm max-w-none text-slate-800 whitespace-pre-wrap">
              {answer}
            </div>
          ) : (
            <div className="text-sm text-slate-400">
              Nessuna risposta ancora. Scrivi una domanda e premi “Chiedi a RevenueAssistant”.
            </div>
          )}

          {/* cronologia locale (facoltativa) */}
          {turns.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <div className="text-xs font-semibold text-slate-500 mb-2">
                Cronologia (solo questa sessione)
              </div>
              <div className="space-y-2 max-h-44 overflow-auto text-xs">
                {turns.map((t, i) => (
                  <div
                    key={i}
                    className={t.role === "user" ? "text-slate-700" : "text-emerald-700"}
                  >
                    <span className="font-semibold mr-1">
                      {t.role === "user" ? "Tu:" : "RA:"}
                    </span>
                    {t.content}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
