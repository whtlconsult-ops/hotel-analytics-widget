// app/api/serp/demand/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const params = Object.fromEntries(u.searchParams.entries());

    const hasKey = !!process.env.SERPAPI_KEY;
    return NextResponse.json({
      ok: true,
      message: "Demand route env OK",
      hasKey,
      params,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, step: "STEP2", error: String(e?.message || e) }, { status: 500 });
  }
}

