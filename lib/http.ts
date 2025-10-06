// lib/http.ts
export type JsonResult<T=any> = { ok: true; data: T } | { ok: false; error: string };

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export const http = {
  async json<T=any>(
    url: string,
    opts?: { timeoutMs?: number; retries?: number; retryDelayMs?: number; init?: RequestInit }
  ): Promise<JsonResult<T>> {
    const timeoutMs = opts?.timeoutMs ?? 8000;
    const retries = Math.max(0, opts?.retries ?? 2);
    const retryDelayMs = opts?.retryDelayMs ?? 350;

    let lastErr: any = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...opts?.init, signal: ctrl.signal });
        clearTimeout(to);
        const ct = res.headers.get("content-type") || "";
        const isJson = ct.includes("json");
        const body = isJson ? await res.json() : await res.text();

        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
        } else {
          return { ok: true, data: body as T };
        }
      } catch (e: any) {
        lastErr = e;
      } finally {
        clearTimeout(to);
      }
      if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
    }
    return { ok: false, error: String(lastErr?.message || lastErr || "Network error") };
  }
};
