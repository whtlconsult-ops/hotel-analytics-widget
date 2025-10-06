// app/api/events/ics/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";

// Unfold delle righe ICS (line folding)
function unfoldIcs(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith(" ") && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function ymdFromIcs(dt: string): string | null {
  const m = dt.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

type IcsEvent = { date: string; title: string; location?: string; lat?: number; lng?: number };

function parseIcs(ics: string): IcsEvent[] {
  const lines = unfoldIcs(ics);
  const events: IcsEvent[] = [];
  let inEvent = false;
  let dt: string | null = null;
  let title = "";
  let location = "";
  let lat: number | undefined;
  let lng: number | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") { inEvent = true; dt = null; title = ""; location = ""; lat = lng = undefined; continue; }
    if (line === "END:VEVENT") {
      if (inEvent && dt) events.push({ date: dt, title: title || "Evento", location: location || undefined, lat, lng });
      inEvent = false; dt = null; title = ""; location = ""; lat = lng = undefined;
      continue;
    }
    if (!inEvent) continue;

    if (line.startsWith("DTSTART")) {
      const parts = line.split(":");
      if (parts.length >= 2) {
        const ymd = ymdFromIcs(parts.slice(1).join(":"));
        if (ymd) dt = ymd;
      }
    } else if (line.startsWith("SUMMARY:")) {
      title = line.slice("SUMMARY:".length).trim();
    } else if (line.startsWith("LOCATION:")) {
      location = line.slice("LOCATION:".length).trim();
    } else if (line.startsWith("GEO:")) {
      const m = line.match(/^GEO:([+-]?\d+(\.\d+)?);([+-]?\d+(\.\d+)?)/);
      if (m) { lat = Number(m[1]); lng = Number(m[3]); }
    }
  }
  return events;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const icsUrl = url.searchParams.get("url");
    if (!icsUrl) return NextResponse.json({ ok: false, error: "Missing ?url=" }, { status: 400 });

    const res = await fetch(icsUrl, {
      headers: { "User-Agent": "HospitalityWidget/1.0 (ICS fetcher)" },
      cache: "force-cache",
      next: { revalidate: 3600 }
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: `HTTP ${res.status}` }, { status: 200 });

    const text = await res.text();
    const events = parseIcs(text);
    return NextResponse.json({ ok: true, events }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
