export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, hasKey: false, error: "SERPAPI_KEY assente su Vercel (Project → Settings → Environment Variables)" },
      { status: 500 }
    );
  }

  try {
    // NB: /account non scala il contatore ricerche.
    const r = await fetch(`https://serpapi.com/account?api_key=${encodeURIComponent(key)}`, { cache: "no-store" });
    const j = await r.json();
    return NextResponse.json({
      ok: true,
      hasKey: true,
      plan_searches_left: j?.plan_searches_left ?? null,
      plan_name: j?.plan_name ?? null,
      this_month_usage: j?.this_month_usage ?? null
      // niente api_key nel payload ✔️
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, hasKey: true, error: String(e?.message || e) }, { status: 500 });
  }
}
