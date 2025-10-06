// lib/params.ts — versione senza zod

// YYYY-MM or YYYY-MM-DD -> normalizza a YYYY-MM-01
export function normalizeMonth(m?: string | null): string | undefined {
  if (!m) return undefined;
  const s = String(m).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return undefined;
}

function cleanStr(v?: string | null, maxLen = 120): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return s.slice(0, maxLen);
}

function clampInt(v: any, min: number, max: number): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.trunc(n);
  if (i < min || i > max) return undefined;
  return i;
}

function asBool(v?: string | null): boolean {
  return v === "1" || v === "true";
}

function oneOf<T extends string>(v: any, allowed: T[]): T | undefined {
  const s = typeof v === "string" ? v : String(v ?? "");
  return allowed.includes(s as T) ? (s as T) : undefined;
}

/**
 * Parsing “safe” dei parametri della main.
 * Restituisce un oggetto già ripulito/normalizzato.
 */
export function parseMainQuery(sp: URLSearchParams) {
  const get = (k: string) => sp.get(k);

  const q = cleanStr(get("q"));
  const r = clampInt(get("r"), 0, 200);
  const m = normalizeMonth(get("m"));

  const tRaw = cleanStr(get("t"), 200);
  const t = tRaw ? tRaw.split(",").map(s => s.trim()).filter(Boolean) : undefined;

  const mode = oneOf(get("mode"), ["zone", "competitor"] as const);
  const wx   = oneOf(get("wx"), ["open-meteo", "openweather"] as const);

  const trend = asBool(get("trend"));
  const ch    = asBool(get("ch"));
  const prov  = asBool(get("prov"));
  const los   = asBool(get("los"));

  return { q, r, m, t, mode, wx, trend, ch, prov, los };
}
