export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // (aiuta a evitare ottimizzazioni)
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
