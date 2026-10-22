import fs from 'node:fs';
import path from 'node:path';

/** Auto-load .env from current directory or ancestor directories once at startup */
function loadDotEnv(): void {
  let curr = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(curr, '.env');
    if (fs.existsSync(candidate)) {
      try {
        const text = fs.readFileSync(candidate, 'utf-8');
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const idx = trimmed.indexOf('=');
          if (idx > 0) {
            const key = trimmed.slice(0, idx).trim();
            let val = trimmed.slice(idx + 1).trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (process.env[key] === undefined) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // Ignore read errors
      }
      break;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
}

loadDotEnv();

/**
 * Read an environment variable. If an array of names is provided, checks each in order
 * and returns the first defined non-empty value.
 * Defaults are for LOCAL DEV ONLY; docker-compose / production must always set real values.
 */
export function env(nameOrNames: string | string[], fallback?: string): string {
  const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') {
      return value;
    }
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
}

/**
 * Read an environment variable as a number with a fallback.
 */
export function envNumber(nameOrNames: string | string[], fallback: number): number {
  try {
    const val = env(nameOrNames, String(fallback));
    const num = Number(val);
    return isNaN(num) ? fallback : num;
  } catch {
    return fallback;
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
