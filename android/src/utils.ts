const ANSI_RE =
  /\x1b\[[0-9;]*m|\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function elapsed(from: string): string {
  const ms = Date.now() - new Date(from).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function timeSince(ts?: string): string {
  if (!ts) return '—';
  return `${elapsed(ts)} ago`;
}

export function noOutputWarning(lastOutputAt?: string): string | null {
  if (!lastOutputAt) return null;
  const secs = Math.floor(
    (Date.now() - new Date(lastOutputAt).getTime()) / 1000,
  );
  if (secs < 60) return null;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h`;
}

export function shortId(id: string): string {
  return id.slice(0, 10);
}

export function fileStatusColor(status: string): string {
  const map: Record<string, string> = {
    M: '#ffd700',
    A: '#00ff9d',
    D: '#ff4444',
    R: '#64b5f6',
    U: '#888',
    '?': '#aaa',
  };
  return map[status] ?? '#aaa';
}
