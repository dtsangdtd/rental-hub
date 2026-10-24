import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** All calls go through the api-gateway. In dev, /api is proxied (proxy.conf.json); in Docker, nginx proxies it. */
export const API_BASE = '/api';

type QueryValue = string | number | boolean | null | undefined;

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return firstValueFrom(this.http.get<T>(API_BASE + path, { params: toParams(query) }));
  }

  post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(API_BASE + path, body));
  }

  put<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.put<T>(API_BASE + path, body));
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(API_BASE + path, body));
  }

  delete<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(API_BASE + path));
  }
}

function toParams(query?: Record<string, QueryValue>): HttpParams {
  let params = new HttpParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
  }
  return params;
}

/** Turn the backend error envelope `{ error: { code, message, details? } }` into a readable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server. Is the API gateway running on :8080?';
    const body = err.error as { error?: { message?: string; details?: unknown } } | null;
    const e = body?.error;
    if (e?.message) {
      const details = formatDetails(e.details);
      return details ? `${e.message}: ${details}` : e.message;
    }
    return `${err.status} ${err.statusText}`;
  }
  return err instanceof Error ? err.message : 'Unexpected error';
}

function formatDetails(details: unknown): string {
  if (!Array.isArray(details)) return '';
  return details
    .map((d) => {
      if (d && typeof d === 'object') {
        const issue = d as { path?: unknown; message?: unknown };
        const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
        return path ? `${path} — ${String(issue.message ?? '')}` : String(issue.message ?? '');
      }
      return String(d);
    })
    .filter(Boolean)
    .join('; ');
}

/** Money rounding identical to the backend rule (AGENTS.md §2.10). */
export const round2 = (x: number) => Math.round(x * 100) / 100;

export const todayIso = () => toIsoDate(new Date());
export function toIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const currentPeriod = () => todayIso().slice(0, 7);
