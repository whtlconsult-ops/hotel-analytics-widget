export const runtime = "nodejs";
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ ok: true, scope: "rates" }, { status: 200 });
}
