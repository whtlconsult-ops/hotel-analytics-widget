"use client";

import React, { useState } from "react";
import Link from "next/link";

type Turn = { role: "user" | "assistant"; content: string };

const MAX_HISTORY = 6;

export default function RevenueAssistantPage() {
  const [question, setQuestion] = useState<string>("");
  const [extraContext, setExtraContext] = useState<string>("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");

  async function handleSend() {
    const q = (question || "").trim();
    if (!q) return;
    setLoading(true);
    setErrorText("");

    // aggiorna cronologia locale con la domanda corrente
    const nextTurns: Turn[] = [...turns, { role: "user" as const, content: q }].slice(-MAX_HISTORY);
    setTurns(nextTurns);

    // payload atteso dal backend: question, context, history
    const payload = {
      question: q,
      context: extraContext ?? "",
      history: nextTurns.map((t) => ({
  role: (t.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
  content: String(t.content || ""),
})),
    };

    try {
      const res = await fetch("/api/revenue-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let j: any = {};
      try {
        j = await res.json();
      } catch {
        j = {};
      }

      // accetta qualunque alias di risposta esposto dal server
      const txt: string =
        j?.text ||
        j?.message ||
        j?.answer ||
        j?.content ||
        j?.output_text ||
        "Nessuna risposta utile.";

      setAnswer(txt);
      setTurns((prev): Turn[] => [...prev, { role: "assistant" as const, content: txt }].slice(-MAX_HISTORY));
      setQuestion(""); // pulisci il campo domanda
    } catch (e: any) {
      const msg = String(e?.message || e || "Errore sconosciuto");
      setErrorText(msg);
      const fallback =
        "Modalità demo: non sono riuscito a contattare il modello in questo momento.\n" +
        "Prova a ripetere la richiesta tra poco.";
      setAnswer(fallback);
      setTurns((prev): Turn[] => [...prev, { role: "assistant" as const, content: fallback }].slice(-MAX_HISTORY));
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!loading) handleSend();
    }
  }

  function clearChat() {
    setTurns([]);
    setAnswer("");
    setErrorText("");
    setQuestion("");
    setExtraContext("");
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* header + stato */}
     <div className="flex items-center justify-between mb-4">
  <div className="flex items-center gap-3">
    <Link href="/" className="text-sm hover:underline flex items-center gap-1">
      <span>←</span> <span>Torna alla Home</span>
    </Link>
    <h1 className="text-xl font-semibold">Revy — RevenueAssistant</h1>
    <span className="text-xs text-neutral-500 hidden sm:inline">puoi chiamarmi <strong>Revy</strong></span>
  </div>
  <div className="flex items-center gap-2">
    {loading ? (
      <span className="inline-flex items-center text-sm">
        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse mr-2" />
        sta ragionando…
      </span>
    ) : (
      <span className="text-sm text-neutral-500">pronto</span>
    )}
  </div>
</div>

      {/* input domanda */}
      <label className="block text-sm font-medium mb-1">La tua domanda</label>
      <input
        className="w-full border rounded-lg px-3 py-2 mb-3 outline-none focus:ring"
        placeholder='Es. Brand reputation di "Borgo Dolci Colline" a Castiglion Fiorentino'
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={handleKey}
        disabled={loading}
      />

      {/* contesto */}
      <label className="block text-sm font-medium mb-1">Contesto (opzionale)</label>
      <textarea
        className="w-full border rounded-lg px-3 py-2 mb-3 outline-none focus:ring min-h-[88px]"
        placeholder="Note utili (periodo, canali, obiettivi, ecc.)"
        value={extraContext}
        onChange={(e) => setExtraContext(e.target.value)}
        disabled={loading}
      />

{/* Suggerimenti rapidi */}
<div className="mb-4 flex flex-wrap items-center gap-2">
  {[
    `Brand reputation di Hotel Esempio a Roma`,
    `Indagine concorrenza agriturismi a Firenze (raggio 30 km)`,
    `Schema prezzi alta/media/bassa per agriturismo vista mare in Maremma`,
  ].map((s, i) => (
    <button
      key={i}
      type="button"
      onClick={() => setQuestion(s)}
      disabled={loading}
      className="text-xs border rounded-full px-3 py-1 hover:bg-neutral-50"
      title="Clicca per usare questo suggerimento"
    >
      {s}
    </button>
  ))}
</div>

      {/* azioni */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={handleSend}
          disabled={loading || !question.trim()}
          className={`px-4 py-2 rounded-lg text-white ${
            loading || !question.trim() ? "bg-neutral-400" : "bg-black hover:opacity-90"
          }`}
        >
          Invia
        </button>
        <button
          onClick={clearChat}
          disabled={loading}
          className="px-3 py-2 rounded-lg border"
        >
          Pulisci
        </button>
      </div>

      {/* errori */}
      {errorText ? (
        <div className="mb-4 text-sm text-red-600 whitespace-pre-wrap">{errorText}</div>
      ) : null}

      {/* ultima risposta */}
      <div className="mb-6">
        <div className="text-sm text-neutral-600 mb-2">Ultima risposta</div>
        <div className="whitespace-pre-wrap border rounded-lg p-3">
          {answer || "—"}
        </div>
      </div>

<div className="mb-6">
  <div className="flex items-center justify-between mb-2">
    <div className="text-sm text-neutral-600">Ultima risposta</div>
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(answer || "");
        } catch {}
      }}
      className="text-xs border rounded px-2 py-1 hover:bg-neutral-50"
      disabled={!answer}
      title="Copia negli appunti"
    >
      Copia
    </button>
  </div>
  <div className="whitespace-pre-wrap border rounded-lg p-3">
    {answer || "—"}
  </div>
</div>

      {/* cronologia breve */}
      <div>
        <div className="text-sm text-neutral-600 mb-2">Cronologia (ultime interazioni)</div>
        <div className="space-y-2">
          {turns.length === 0 ? (
            <div className="text-sm text-neutral-500">Nessuna interazione.</div>
          ) : (
            turns.slice(-MAX_HISTORY).map((t, i) => (
              <div key={i} className="border rounded-lg p-2">
                <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                  {t.role === "assistant" ? "RA" : "Tu"}
                </div>
                <div className="whitespace-pre-wrap text-sm">{t.content}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
