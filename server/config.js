import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

export const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  defaultLanguage: process.env.DEFAULT_LANGUAGE || 'id-ID',
  cacheTtl: {
    catalog: (Number(process.env.CACHE_TTL_CATALOG) || 360) * 1000,
    search: (Number(process.env.CACHE_TTL_SEARCH) || 300) * 1000,
    detail: (Number(process.env.CACHE_TTL_DETAIL) || 600) * 1000,
    categories: (Number(process.env.CACHE_TTL_CATEGORIES) || 900) * 1000,
    stream: (Number(process.env.CACHE_TTL_STREAM) || 90) * 1000
  },
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    maxApi: Number(process.env.RATE_LIMIT_MAX_API) || 240,
    maxProxy: Number(process.env.RATE_LIMIT_MAX_PROXY) || 3000
  },
  rootDir,
  publicDir: path.join(rootDir, 'public')
};
