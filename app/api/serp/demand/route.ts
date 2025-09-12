// app/api/serp/demand/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const params = Object.fromEntries(u.searchParams.entries());
    return NextResponse.json({
      ok: true,
      message: "Demand route minimal OK",
      echo: params,
      // NON usiamo env né fetch esterni qui
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, step: "STEP1", error: String(e?.message || e) }, { status: 500 });
  }
}
