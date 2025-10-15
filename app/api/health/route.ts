export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, msg: "api up" }, { status: 200 });
}
