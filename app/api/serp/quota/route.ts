export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  // Accetta entrambi i nomi della env per sicurezza
  const key = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "SERPAPI_KEY mancante" }, { status: 500 });
  }
  try {
    const r = await fetch(
      `https://serpapi.com/account?api_key=${encodeURIComponent(key)}`,
      { cache: "no-store" }
    );
    const j = await r.json();
    // Rispondiamo in forma semplice e coerente con il badge
    return NextResponse.json({ ok: true, ...j }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
