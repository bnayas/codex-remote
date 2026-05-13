import { Session, ChangedFile } from './types';

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
  return elapsed(ts) + ' ago';
}

export function statusColor(status: Session['status'] | string): string {
  switch (status) {
    case 'running': return '#00ff9d';
    case 'starting': return '#ffd700';
    case 'exited': return '#888';
    case 'killed': return '#ff4444';
    case 'error': return '#ff4444';
    default: return '#555';
  }
}

export function fileStatusBadge(s: ChangedFile['status']): string {
  const map: Record<string, string> = { M: 'M', A: 'A', D: 'D', R: 'R', U: 'U', '?': '?' };
  return map[s] || s;
}

export function fileStatusColor(s: ChangedFile['status']): string {
  const map: Record<string, string> = {
    M: '#ffd700', A: '#00ff9d', D: '#ff4444', R: '#64b5f6', U: '#888', '?': '#aaa',
  };
  return map[s] || '#aaa';
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /**/ }

  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Derive a human-readable agent name from the CLI command string.
 * Supports: cn → Continue, codex → Codex, claude → Claude Code, etc.
 */
export function agentDisplayName(command?: string): string {
  if (!command) return 'Agent';
  const base = command.split(/[\\/]/).pop()?.split(/\s/)[0]?.toLowerCase() || '';
  if (base === 'cn' || base === 'continue') return 'Continue';
  if (base === 'codex') return 'Codex';
  if (base === 'claude') return 'Claude Code';
  if (base === 'aider') return 'Aider';
  if (base === 'gemini') return 'Gemini CLI';
  // Fallback: capitalize first letter
  return base.charAt(0).toUpperCase() + base.slice(1) || 'Agent';
}
