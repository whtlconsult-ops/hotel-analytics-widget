// app/api/external/holidays/route.ts
import { NextResponse } from "next/server";

/** Cache 12h su edge/server */
const REVALIDATE_SECONDS = 60 * 60 * 12;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const year = searchParams.get("year") || new Date().getFullYear().toString();
    const country = searchParams.get("country") || "IT";

    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `HTTP ${res.status}` }, { status: 500 });
    }

    const json = await res.json(); // [{date:"2025-01-01", localName:"Capodanno", ...}, ...]
    return NextResponse.json({ ok: true, holidays: json });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
