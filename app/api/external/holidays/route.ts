// app/api/external/holidays/route.ts
import { NextRequest, NextResponse } from "next/server";

export const revalidate = 86400; // 24h cache lato server

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get("year"));
    const country = (searchParams.get("country") || "IT").toUpperCase();

    if (!year || year < 1900 || year > 2100) {
      return NextResponse.json({ ok: false, error: "Invalid year" }, { status: 400 });
    }

    // API pubblica Nager.Date
    const upstream = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`,
      { next: { revalidate } }
    );

    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `Upstream ${upstream.status}` },
        { status: 502 }
      );
    }

    const data = await upstream.json();

    // normalizza -> { date, localName, name }
    const holidays = Array.isArray(data)
      ? data.map((h: any) => ({
          date: h.date,
          localName: h.localName || h.name,
          name: h.name,
        }))
      : [];

    return NextResponse.json({ ok: true, holidays });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

