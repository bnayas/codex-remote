import {
  Project, Session, Plan, GitStatus, DiffResult, ScheduledMessage,
  RepoContext, RepoTree, RepoFileContent, CodexConversation,
} from './types';

let authToken = localStorage.getItem('codex_auth_token') || '';
let baseUrl = localStorage.getItem('codex_base_url') || '';

export function setCredentials(url: string, token: string): void {
  baseUrl = url.replace(/\/$/, '');
  authToken = token;
  localStorage.setItem('codex_base_url', baseUrl);
  localStorage.setItem('codex_auth_token', authToken);
}

export function getCredentials() {
  return { baseUrl, authToken };
}

export function clearCredentials(): void {
  baseUrl = '';
  authToken = '';
  localStorage.removeItem('codex_base_url');
  localStorage.removeItem('codex_auth_token');
}

export function isConfigured(): boolean {
  return !!(baseUrl && authToken);
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${authToken}`,
  };
  if (body != null) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string; message?: string };
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean; timestamp: string }>('GET', '/health'),

  getProjects: () => req<Project[]>('GET', '/projects'),
  getRepoContext: (id: string) => req<RepoContext>('GET', `/projects/${id}/context`),
  getCodexConversations: (id: string) =>
    req<CodexConversation[]>('GET', `/projects/${id}/codex-conversations`),
  resumeCodexConversation: (projectId: string, conversationId: string) =>
    req<Session>('POST', `/projects/${projectId}/codex-conversations/${encodeURIComponent(conversationId)}/resume`),
  getProject: (id: string) => req<Project>('GET', `/projects/${id}`),

  getSessions: () => req<Session[]>('GET', '/sessions'),
  getSession: (id: string) => req<Session & { alive: boolean; terminalAlive: boolean }>('GET', `/sessions/${id}`),
  createSession: (body: { projectId: string; title?: string; initialPrompt?: string }) =>
    req<Session>('POST', '/sessions', body),

  sendInput: (sessionId: string, text: string) =>
    req<{ ok: boolean }>('POST', `/sessions/${sessionId}/input`, { text }),
  sendShellInput: (sessionId: string, text: string) =>
    req<{ ok: boolean }>('POST', `/sessions/${sessionId}/shell/input`, { text }),
  interrupt: (sessionId: string) =>
    req<{ ok: boolean }>('POST', `/sessions/${sessionId}/interrupt`, { confirm: true }),
  interruptShell: (sessionId: string) =>
    req<{ ok: boolean }>('POST', `/sessions/${sessionId}/shell/interrupt`, { confirm: true }),
  terminate: (sessionId: string) =>
    req<{ ok: boolean }>('POST', `/sessions/${sessionId}/terminate`, { confirm: true }),
  terminateShell: (sessionId: string) =>
    req<{ ok: boolean }>('POST', `/sessions/${sessionId}/shell/terminate`, { confirm: true }),
  killTree: (sessionId: string) =>
    req<{ ok: boolean }>('POST', `/sessions/${sessionId}/kill-tree`, { confirm: true }),
  killShellTree: (sessionId: string) =>
    req<{ ok: boolean }>('POST', `/sessions/${sessionId}/shell/kill-tree`, { confirm: true }),

  getTerminal: (sessionId: string, lines = 200) =>
    req<{ lines: string[]; total: number }>('GET', `/sessions/${sessionId}/terminal?lines=${lines}`),
  getShellTerminal: (sessionId: string, lines = 200) =>
    req<{ lines: string[]; total: number }>('GET', `/sessions/${sessionId}/shell/terminal?lines=${lines}`),

  getFiles: (sessionId: string) =>
    req<GitStatus>('GET', `/sessions/${sessionId}/files`),
  getDiff: (sessionId: string, maxLines = 2000) =>
    req<DiffResult>('GET', `/sessions/${sessionId}/diff?maxLines=${maxLines}`),
  getFileDiff: (sessionId: string, filePath: string, maxLines = 2000) =>
    req<DiffResult>('GET', `/sessions/${sessionId}/files/${encodeURIComponent(filePath)}/diff?maxLines=${maxLines}`),
  getRepoTree: (sessionId: string, repoPath = '') =>
    req<RepoTree>('GET', `/sessions/${sessionId}/repo/tree?path=${encodeURIComponent(repoPath)}`),
  getRepoFile: (sessionId: string, repoPath: string, maxBytes = 524288) =>
    req<RepoFileContent>('GET', `/sessions/${sessionId}/repo/file?path=${encodeURIComponent(repoPath)}&maxBytes=${maxBytes}`),

  getPlans: (sessionId: string) =>
    req<Plan[]>('GET', `/sessions/${sessionId}/plans`),
  createPlan: (sessionId: string, body: { originalText: string; editedText?: string }) =>
    req<Plan>('POST', `/sessions/${sessionId}/plans`, body),
  updatePlan: (planId: string, body: { status?: string; editedText?: string }) =>
    req<Plan>('PUT', `/plans/${planId}`, body),
  sendPlan: (sessionId: string, body: { planId?: string; text: string; action?: string }) =>
    req<{ ok: boolean; sentMessage: string }>('POST', `/sessions/${sessionId}/send-plan`, body),

  getScheduledMessages: (sessionId: string) =>
    req<ScheduledMessage[]>('GET', `/sessions/${sessionId}/scheduled`),
  scheduleMessage: (sessionId: string, body: { text: string; delayMs: number }) =>
    req<ScheduledMessage>('POST', `/sessions/${sessionId}/scheduled`, body),
  cancelScheduledMessage: (sessionId: string, id: string) =>
    req<{ ok: boolean }>('DELETE', `/sessions/${sessionId}/scheduled/${id}`),
};

export function buildWsUrl(sessionId: string, channel: 'agent' | 'shell' = 'agent'): string {
  const wsBase = baseUrl.replace(/^http/, 'ws');
  const path = channel === 'shell'
    ? `/sessions/${sessionId}/shell/stream`
    : `/sessions/${sessionId}/stream`;
  return `${wsBase}${path}?token=${encodeURIComponent(authToken)}`;
}
