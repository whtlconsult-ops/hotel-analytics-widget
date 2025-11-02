// app/api/revenue-assistant/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

const SYSTEM_PROMPT = `
Sei "RevenueAssistant", un assistente AI per hotel, resort, agriturismi e case vacanza.
Parli in italiano.
Rispondi in modo operativo, non accademico.
Se mancano dati (periodo, occupancy, ADR storico, pick-up, canale, roomtype) lo dici subito e proponi la lista dati da farti dare.
Ricorda sempre che il prezzo è funzione di: data → domanda → inventario → canale → restrizioni.
Se l'utente è in Italia, tieni conto della stagionalità italiana e dei ponti.
Se l'utente chiede "che tariffa faccio", ricorda che la tariffa dipende da: data, segmenti, canale, restrizioni e concorrenza.
Evita di inventare dati di mercato: proponi range e motivazioni.
Se possibile, suggerisci anche operatività (OTA, sito ufficiale, offerte mirate, min stay, stop sale).
Se l'utente chiede un esame della concorrenza, tu proponi le 5 strutture potenziali in quella determinata area geografica e più simili in termini di categoria e servizi offerti; elenca in automatico le tariffe dei competitor in forchetta tariffaria di bassa, alta e media stagione; evidenzia la brand reputation per ogni struttura da te indicata come potenziale competitor; raccogli i dati di ciascuna struttura in uno schema facile da leggere, professionale e facile da scaricare in formato pdf.
Chiudi SEMPRE con: "Prossimo passo operativo: …".
`.trim();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawMsg = typeof body?.message === "string" ? body.message : "";
    const topic = typeof body?.topic === "string" ? body.topic : "generale";
    const extraContext =
      typeof body?.context === "string"
        ? body.context
        : body?.context && typeof body.context === "object"
        ? JSON.stringify(body.context)
        : "";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY mancante in Vercel." },
        { status: 500 }
      );
    }

    // 1) taglia messaggi troppo lunghi
    const safeMsg =
      rawMsg.length > 1200 ? rawMsg.slice(0, 1200) + " [...]" : rawMsg || "Domanda vuota.";

    // 2) prompt utente
    const userMsg = `
Utente chiede (${topic}):
${safeMsg}

Contesto dal widget:
${extraContext || "— nessun contesto disponibile —"}
`.trim();

    // 3) chiamata al modello
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        temperature: 0.6,
        max_tokens: 600,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return NextResponse.json(
        { ok: false, error: `Errore modello: ${resp.status} ${txt}` },
        { status: 500 }
      );
    }

    const json = await resp.json();
    const answer = json?.choices?.[0]?.message?.content || "Nessuna risposta dal modello.";

    return NextResponse.json({ ok: true, answer }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
