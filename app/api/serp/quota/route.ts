export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  const key = process.env.SERPAPI_KEY || process.env.SERP_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "SERPAPI_KEY mancante" }, { status: 500 });
  }
  try {
    const r = await fetch(`https://serpapi.com/account?api_key=${encodeURIComponent(key)}`, { cache: "no-store" });
    const j = await r.json();
    return NextResponse.json({ ok: true, ...j });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
