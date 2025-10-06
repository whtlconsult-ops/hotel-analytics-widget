// lib/params.ts
import { z } from "zod";

// YYYY-MM or YYYY-MM-DD -> normalizza a YYYY-MM-01
export function normalizeMonth(m?: string | null): string | undefined {
  if (!m) return undefined;
  const s = String(m);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return undefined;
}

const boolFrom = (v: string | null) => v === "1" || v === "true";

export const mainQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  r: z.coerce.number().int().min(0).max(200).optional(),
  m: z.string().optional(),        // la normalizziamo noi
  t: z.string().optional(),        // "hotel,b&b"
  mode: z.enum(["zone","competitor"]).optional(),
  wx: z.enum(["open-meteo","openweather"]).optional(),
  trend: z.string().optional(),
  ch: z.string().optional(),
  prov: z.string().optional(),
  los: z.string().optional(),
});

export function parseMainQuery(sp: URLSearchParams) {
  const raw = Object.fromEntries(sp.entries());
  const safe = mainQuerySchema.safeParse(raw).success ? mainQuerySchema.parse(raw) : {};
  const out = {
    q: safe.q,
    r: safe.r,
    m: normalizeMonth(safe.m),
    t: Array.isArray(safe.t?.split(",")) ? safe.t!.split(",").filter(Boolean) : undefined,
    mode: safe.mode,
    wx: safe.wx,
    trend: boolFrom(safe.trend ?? null),
    ch:    boolFrom(safe.ch ?? null),
    prov:  boolFrom(safe.prov ?? null),
    los:   boolFrom(safe.los ?? null),
  };
  return out;
}
