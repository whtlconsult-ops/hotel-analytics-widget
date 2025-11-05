"use client";

import { useState } from "react";

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

    // Aggiorna cronologia locale (mostriamo subito la tua domanda)
    const nextTurns: Turn[] = [...turns, { role: "user", content: q }].slice(-MAX_HISTORY);
    setTurns(nextTurns);

    // Costruisci un payload compatibile con il route del RA
    const payload = {
      question: q,                          // <-- chiave attesa dal server
      context: extraContext ?? "",
      history: nextTurns.map((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content: String(t.content || "")
      }))
    };

    try {
      const res = await fetch("/api/revenue-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let j: any = {};
      try { j = await res.json(); } catch { j = {}; }

      const txt: string =
        j?.text ||
        j?.message ||
        j?.answer ||
        j?.content ||
        j?.output_text ||
        "Nessuna risposta utile.";

      setAnswer(txt);
      setTurns((prev) => [...prev, { role: "assistant", content: txt }].slice(-MAX_HISTORY));
      setQuestion(""); // pulisci il campo domanda
    } catch (e: any) {
      const msg = String(e?.message || e || "Errore sconosciuto");
      setErrorText(msg);
      const fallback =
        "Modalità demo: non sono riuscito a contattare il modello in questo momento.\n" +
        "Prova a ripetere la richiesta tra poco.";
      setAnswer(fallback);
      setTurns((prev) => [...prev, { role: "assistant", content: fallback }].slice(-MAX_HISTORY));
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
      {/* Top row: titolo + stato esecuzione */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">RevenueAssistant</h1>
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="inline-flex items-center text-sm">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse mr-2"></span>
              sta ragionando…
            </span>
          ) : (
            <span className="text-sm text-neutral-500">pronto</span>
          )}
        </div>
      </div>

      {/* Input domanda */}
      <label className="block text-sm font-medium mb-1">La tua domanda</label>
      <input
        className="w-full border rounded-lg px-3 py-2 mb-3 outline-none focus:ring"
        placeholder="Es. Brand reputation di &quot;Borgo Dolci Colline&quot; a Castiglion Fiorentino"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={handleKey}
        disabled={loading}
      />

      {/* Contesto aggiuntivo */}
      <label className="block text-sm font-medium mb-1">Contesto (opzionale)</label>
      <textarea
        className="w-full border rounded-lg px-3 py-2 mb-3 outline-none focus:ring min-h-[88px]"
        placeholder="Note utili (es. periodo di analisi, canali chiave, obiettivi, ecc.)"
        value={extraContext}
        onChange={(e) => setExtraContext(e.target.value)}
        disabled={loading}
      />

      {/* Actions */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={handleSend}
          disabled={loading || !question.trim()}
          className={`px-4 py-2 rounded-lg text-white ${loading || !question.trim() ? "bg-neutral-400" : "bg-black hover:opacity-90"}`}
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

      {/* Esito/risposta */}
      {errorText ? (
        <div className="mb-4 text-sm text-red-600 whitespace-pre-wrap">{errorText}</div>
      ) : null}

      <div className="mb-6">
        <div className="text-sm text-neutral-600 mb-2">Ultima risposta</div>
        <div className="whitespace-pre-wrap border rounded-lg p-3">
          {answer || "—"}
        </div>
      </div>

      {/* Cronologia breve */}
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
