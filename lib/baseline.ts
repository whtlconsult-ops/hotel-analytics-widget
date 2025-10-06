// lib/baseline.ts
import { format } from "date-fns";
import { it } from "date-fns/locale";

export function seasonalityItaly12(): number[] {
  // Profilo nazionale (arrivi/presenze tipiche): 12 valori, max ~100
  return [45,48,62,72,86,96,100,98,90,70,52,48];
}

export function cityFromTopic(topic: string): string {
  if (!topic) return "";
  let s = topic
    .replace(/hotel|alberghi?|b&b|resort|alloggi|alloggio/ig, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) s = topic.trim();
  return s;
}

export function last12LabelsLLLyy(): string[] {
  const now = new Date();
  const arr: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push(format(d, "LLL yy", { locale: it }));
  }
  return arr;
}

/**
 * Normalizza un array numerico (senza NaN) a max=100
 * Se tutti zero, restituisce tutti zero.
 */
export function normalizeTo100(values: number[]): number[] {
  const max = Math.max(0, ...values.map(v => Number(v) || 0));
  if (max <= 0) return values.map(() => 0);
  return values.map(v => Math.round((Number(v) || 0) * 100 / max));
}

/**
 * Blend elemento-per-elemento (stesse lunghezze) con pesi dati.
 */
export function blend3(a: number[], b: number[], c: number[], wA: number, wB: number, wC: number): number[] {
  const n = Math.max(a.length, b.length, c.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    const vc = c[i] ?? 0;
    const v  = (wA * va) + (wB * vb) + (wC * vc);
    out.push(v);
  }
  return out;
}
