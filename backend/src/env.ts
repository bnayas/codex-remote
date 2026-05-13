import fs from 'fs';
import path from 'path';

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    const unquoted = trimmed.slice(1, -1);
    return quote === '"' ? unquoted.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : unquoted;
  }

  return trimmed;
}

export function loadBackendEnv(): number {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return 0;

  let loaded = 0;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separator = normalized.indexOf('=');
    if (separator <= 0) continue;

    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;

    process.env[key] = parseEnvValue(normalized.slice(separator + 1));
    loaded += 1;
  }

  return loaded;
}
