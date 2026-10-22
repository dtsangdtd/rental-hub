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
 * Read an environment variable. Defaults are for LOCAL DEV ONLY;
 * docker-compose / production must always set real values.
 */
export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
