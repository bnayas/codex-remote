import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import {
  getAllProjects, getProjectById, getAllSessions, getSessionsByProject,
  getSessionById, createPlan, updatePlan, getPlansBySession,
  getLatestFileSnapshot, createScheduledMessage, getScheduledMessagesBySession, updateScheduledMessageStatus,
  Session
} from '../db';
import { AppConfig } from '../config';
import {
  startSession, writeToSession, interruptSession,
  terminateSession, killSessionTree, getRecentOutput,
  isSessionAlive, getShellRecentOutput, isShellAlive,
  writeToShell, interruptShell, terminateShell, killShellTree, ensureShellSession
} from '../ptyManager';
import { getGitStatus, getDiff, getDiffStat, getLastCommits } from '../git';
import { syncProjectsFromNotion } from '../notion';
import { listCodexConversationsForRepo } from '../codexHistory';

export async function registerRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    ok: true,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }));

  // ── Projects ────────────────────────────────────────────────────────────────
  app.get('/projects', async () => {
    const projects = getAllProjects();
    return projects.map(p => ({
      ...p,
      sessions: getSessionsByProject(p.id).slice(0, 5).map(sessionSummary),
    }));
  });

  app.get('/projects/:projectId/context', async (
    req: FastifyRequest<{ Params: { projectId: string } }>,
    reply: FastifyReply
  ) => {
    const p = getProjectById(req.params.projectId);
    if (!p) return reply.status(404).send({ error: 'Project not found' });
    return projectContext(p);
  });

  app.get('/projects/:projectId/codex-conversations', async (
    req: FastifyRequest<{ Params: { projectId: string }; Querystring: { limit?: string } }>,
    reply: FastifyReply
  ) => {
    const p = getProjectById(req.params.projectId);
    if (!p) return reply.status(404).send({ error: 'Project not found' });

    const limit = Math.max(1, Math.min(parseInt(req.query.limit ?? '50') || 50, 100));
    return listCodexConversationsForRepo(p.repoPath, limit);
  });

  app.post('/projects/:projectId/codex-conversations/:conversationId/resume', async (
    req: FastifyRequest<{ Params: { projectId: string; conversationId: string } }>,
    reply: FastifyReply
  ) => {
    const project = getProjectById(req.params.projectId);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    const conversations = await listCodexConversationsForRepo(project.repoPath, 1000);
    const conversation = conversations.find(c => c.id === req.params.conversationId);
    if (!conversation) return reply.status(404).send({ error: 'Codex conversation not found for this project' });

    try {
      const sessionId = await startSession(project, {
        title: conversation.threadName,
        command: 'codex',
        args: ['resume', conversation.id],
      });
      const session = getSessionById(sessionId);
      return reply.status(201).send(session ? sessionSummary(session) : undefined);
    } catch (err: unknown) {
      const e = err as Error;
      return reply.status(500).send({ error: 'Failed to resume Codex conversation', message: e.message });
    }
  });

  app.get('/projects/:projectId', async (req: FastifyRequest<{ Params: { projectId: string } }>, reply: FastifyReply) => {
    const p = getProjectById(req.params.projectId);
    if (!p) return reply.status(404).send({ error: 'Project not found' });
    return { ...p, sessions: getSessionsByProject(p.id).map(sessionSummary) };
  });

  app.post('/projects/sync-notion', async (_req, reply: FastifyReply) => {
    try {
      const result = await syncProjectsFromNotion(config);
      return result;
    } catch (err: unknown) {
      return reply.status(500).send({ error: 'Notion sync failed', message: (err as Error).message });
    }
  });

  // ── Sessions ────────────────────────────────────────────────────────────────
  app.get('/sessions', async () => getAllSessions().map(sessionSummary));

  app.get('/sessions/:sessionId', async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    const s = getSessionById(req.params.sessionId);
    if (!s) return reply.status(404).send({ error: 'Session not found' });
    return sessionSummary(s);
  });

  app.post('/sessions', async (
    req: FastifyRequest<{ Body: { projectId: string; title?: string; initialPrompt?: string } }>,
    reply: FastifyReply
  ) => {
    const { projectId, title, initialPrompt } = req.body;
    const project = getProjectById(projectId);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    try {
      const sessionId = await startSession(project, {
        title,
        initialPrompt: withProjectPlanContext(initialPrompt, project),
      });
      const session = getSessionById(sessionId);
      return reply.status(201).send(session ? sessionSummary(session) : undefined);
    } catch (err: unknown) {
      const e = err as Error;
      return reply.status(500).send({ error: 'Failed to start session', message: e.message });
    }
  });

  // ── Session input/control ───────────────────────────────────────────────────
  app.post('/sessions/:sessionId/input', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Body: { text: string } }>,
    reply: FastifyReply
  ) => {
    const ok = writeToSession(req.params.sessionId, req.body.text);
    if (!ok) return reply.status(404).send({ error: 'Session not active' });
    return { ok: true };
  });

  app.post('/sessions/:sessionId/interrupt', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Body?: { confirm?: boolean } }>,
    reply: FastifyReply
  ) => {
    const ok = interruptSession(req.params.sessionId);
    if (!ok) return reply.status(404).send({ error: 'Session not active' });
    return { ok: true };
  });

  app.post('/sessions/:sessionId/terminate', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Body?: { confirm?: boolean } }>,
    reply: FastifyReply
  ) => {
    if (req.body?.confirm !== true) {
      return reply.status(400).send({ error: 'Confirmation required', message: 'Stop requires confirm: true' });
    }
    const ok = terminateSession(req.params.sessionId);
    if (!ok) return reply.status(404).send({ error: 'Session not active' });
    return { ok: true };
  });

  app.post('/sessions/:sessionId/kill-tree', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Body?: { confirm?: boolean } }>,
    reply: FastifyReply
  ) => {
    if (req.body?.confirm !== true) {
      return reply.status(400).send({ error: 'Confirmation required', message: 'Kill Tree requires confirm: true' });
    }
    const ok = await killSessionTree(req.params.sessionId);
    if (!ok) return reply.status(404).send({ error: 'Session not active or kill failed' });
    return { ok: true };
  });

  // ── Terminal scrollback ─────────────────────────────────────────────────────
  app.get('/sessions/:sessionId/terminal', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Querystring: { lines?: string } }>,
    reply: FastifyReply
  ) => {
    const lines = parseInt(req.query.lines ?? '200') || 200;
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    const output = getRecentOutput(req.params.sessionId, lines);
    return { lines: output, total: output.length };
  });

  app.get('/sessions/:sessionId/shell/terminal', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Querystring: { lines?: string } }>,
    reply: FastifyReply
  ) => {
    const lines = parseInt(req.query.lines ?? '200') || 200;
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    ensureShellSession(req.params.sessionId);
    const output = getShellRecentOutput(req.params.sessionId, lines);
    return { lines: output, total: output.length };
  });

  app.post('/sessions/:sessionId/shell/input', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Body: { text: string } }>,
    reply: FastifyReply
  ) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    ensureShellSession(req.params.sessionId);
    const ok = writeToShell(req.params.sessionId, req.body.text);
    if (!ok) return reply.status(404).send({ error: 'Terminal session not active' });
    return { ok: true };
  });

  app.post('/sessions/:sessionId/shell/interrupt', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Body?: { confirm?: boolean } }>,
    reply: FastifyReply
  ) => {
    ensureShellSession(req.params.sessionId);
    const ok = interruptShell(req.params.sessionId);
    if (!ok) return reply.status(404).send({ error: 'Terminal session not active' });
    return { ok: true };
  });

  app.post('/sessions/:sessionId/shell/terminate', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Body?: { confirm?: boolean } }>,
    reply: FastifyReply
  ) => {
    if (req.body?.confirm !== true) {
      return reply.status(400).send({ error: 'Confirmation required', message: 'Stop Terminal requires confirm: true' });
    }
    const ok = terminateShell(req.params.sessionId);
    if (!ok) return reply.status(404).send({ error: 'Terminal session not active' });
    return { ok: true };
  });

  app.post('/sessions/:sessionId/shell/kill-tree', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Body?: { confirm?: boolean } }>,
    reply: FastifyReply
  ) => {
    if (req.body?.confirm !== true) {
      return reply.status(400).send({ error: 'Confirmation required', message: 'Kill Terminal requires confirm: true' });
    }
    const ok = await killShellTree(req.params.sessionId);
    if (!ok) return reply.status(404).send({ error: 'Terminal session not active or kill failed' });
    return { ok: true };
  });

  // ── Files & diffs ───────────────────────────────────────────────────────────
  app.get('/sessions/:sessionId/files', async (
    req: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply
  ) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    try {
      const [status, diffStat] = await Promise.all([
        getGitStatus(session.repoPath),
        getDiffStat(session.repoPath),
      ]);
      return { ...status, diffStat };
    } catch (err: unknown) {
      const e = err as Error;
      return reply.status(500).send({ error: 'Git error', message: e.message });
    }
  });

  app.get('/sessions/:sessionId/diff', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Querystring: { maxLines?: string } }>,
    reply: FastifyReply
  ) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    const maxLines = parseInt(req.query.maxLines ?? '2000') || 2000;
    try {
      return await getDiff(session.repoPath, undefined, maxLines);
    } catch (err: unknown) {
      const e = err as Error;
      return reply.status(500).send({ error: 'Git diff error', message: e.message });
    }
  });

  app.get('/sessions/:sessionId/files/:encodedPath/diff', async (
    req: FastifyRequest<{ Params: { sessionId: string; encodedPath: string }; Querystring: { maxLines?: string } }>,
    reply: FastifyReply
  ) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    const filePath = decodeURIComponent(req.params.encodedPath);
    const maxLines = parseInt(req.query.maxLines ?? '2000') || 2000;
    try {
      return await getDiff(session.repoPath, filePath, maxLines);
    } catch (err: unknown) {
      const e = err as Error;
      return reply.status(500).send({ error: 'Git diff error', message: e.message });
    }
  });

  app.get('/sessions/:sessionId/repo/tree', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Querystring: { path?: string; limit?: string } }>,
    reply: FastifyReply
  ) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    try {
      const limit = Math.max(20, Math.min(parseInt(req.query.limit ?? '250') || 250, 500));
      return await listRepoDirectory(session.repoPath, req.query.path ?? '', limit);
    } catch (err: unknown) {
      const e = err as Error;
      return reply.status(400).send({ error: 'File tree error', message: e.message });
    }
  });

  app.get('/sessions/:sessionId/repo/file', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Querystring: { path: string; maxBytes?: string } }>,
    reply: FastifyReply
  ) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    try {
      const maxBytes = Math.max(16 * 1024, Math.min(parseInt(req.query.maxBytes ?? '524288') || 524288, 1024 * 1024));
      return await readRepoFile(session.repoPath, req.query.path, maxBytes);
    } catch (err: unknown) {
      const e = err as Error;
      return reply.status(400).send({ error: 'File read error', message: e.message });
    }
  });

  // ── Plans ───────────────────────────────────────────────────────────────────
  app.get('/sessions/:sessionId/plans', async (
    req: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply
  ) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return getPlansBySession(req.params.sessionId);
  });

  app.post('/sessions/:sessionId/plans', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Body: { originalText: string; editedText?: string } }>,
    reply: FastifyReply
  ) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    const plan = createPlan({
      id: uuidv4(),
      sessionId: req.params.sessionId,
      status: 'draft',
      originalText: req.body.originalText,
      editedText: req.body.editedText,
    });
    return reply.status(201).send(plan);
  });

  app.put('/plans/:planId', async (
    req: FastifyRequest<{ Params: { planId: string }; Body: { status?: string; editedText?: string } }>,
    reply: FastifyReply
  ) => {
    const plan = updatePlan(req.params.planId, {
      status: req.body.status as 'draft' | 'sent' | 'approved' | 'rejected' | undefined,
      editedText: req.body.editedText,
    });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });
    return plan;
  });

  app.post('/sessions/:sessionId/send-plan', async (
    req: FastifyRequest<{
      Params: { sessionId: string };
      Body: { planId?: string; text: string; action?: string }
    }>,
    reply: FastifyReply
  ) => {
    const { sessionId } = req.params;
    const { text, action, planId } = req.body;

    let message: string;
    if (action === 'approve') {
      message = `Approved. Please proceed with the plan as discussed.`;
    } else if (action === 'step1') {
      message = `Implement step 1 only. Do not proceed to further steps without my confirmation.`;
    } else if (action === 'revise') {
      message = `Use this revised plan instead:\n\n${text}\n\nBefore editing files, acknowledge this revised plan and wait for my confirmation unless I explicitly told you to continue.`;
    } else if (action === 'stop') {
      message = `Stop current work and provide a summary of what has been done so far.`;
    } else {
      message = text;
    }

    if (planId) {
      updatePlan(planId, { status: 'sent' });
    }

    const ok = writeToSession(sessionId, message);
    if (!ok) return reply.status(404).send({ error: 'Session not active' });
    return { ok: true, sentMessage: message };
  });

  // ── Scheduled Messages ───────────────────────────────────────────────────────
  app.get('/sessions/:sessionId/scheduled', async (
    req: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply
  ) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return getScheduledMessagesBySession(req.params.sessionId).filter(sm => sm.status === 'pending');
  });

  app.post('/sessions/:sessionId/scheduled', async (
    req: FastifyRequest<{ Params: { sessionId: string }; Body: { text: string; delayMs: number } }>,
    reply: FastifyReply
  ) => {
    const session = getSessionById(req.params.sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    
    const sendAfter = new Date(Date.now() + req.body.delayMs).toISOString();
    const msg = createScheduledMessage({
      id: uuidv4(),
      sessionId: req.params.sessionId,
      text: req.body.text,
      status: 'pending',
      sendAfter,
    });
    return reply.status(201).send(msg);
  });

  app.delete('/sessions/:sessionId/scheduled/:id', async (
    req: FastifyRequest<{ Params: { sessionId: string; id: string } }>,
    reply: FastifyReply
  ) => {
    updateScheduledMessageStatus(req.params.id, 'cancelled');
    return { ok: true };
  });
}

function sessionSummary(s: Session) {
  return {
    ...s,
    alive: isSessionAlive(s.id),
    terminalAlive: isShellAlive(s.id),
  };
}

async function projectContext(project: ReturnType<typeof getAllProjects>[number]) {
  const [gitStatus, lastCommits] = await Promise.all([
    getGitStatus(project.repoPath).catch(() => undefined),
    getLastCommits(project.repoPath, 5),
  ]);

  return {
    project,
    branch: gitStatus?.branch ?? 'unknown',
    isClean: gitStatus?.isClean ?? true,
    changedFilesCount: gitStatus?.changedFiles.length ?? 0,
    lastCommits,
  };
}

function withProjectPlanContext(
  prompt: string | undefined,
  project: {
    developmentPlan?: string;
    nextStep?: string;
    planStatus?: string;
    notionPageUrl?: string;
  }
): string | undefined {
  const contextLines = [
    project.developmentPlan ? `Development plan: ${project.developmentPlan}` : undefined,
    project.nextStep ? `Next step: ${project.nextStep}` : undefined,
    project.planStatus ? `Plan status: ${project.planStatus}` : undefined,
    project.notionPageUrl ? `Notion project page: ${project.notionPageUrl}` : undefined,
  ].filter(Boolean);

  if (contextLines.length === 0) return prompt;

  const context = `Current Notion repo context:\n${contextLines.map(line => `- ${line}`).join('\n')}`;
  return prompt ? `${context}\n\nUser request:\n${prompt}` : context;
}

const DEFAULT_IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', '.turbo', '.gradle',
  'DerivedData', 'Pods', 'coverage', '.venv', 'venv',
]);

function resolveRepoChild(repoPath: string, requestedPath = ''): { root: string; absolutePath: string; relativePath: string } {
  const root = path.resolve(repoPath);
  const absolutePath = path.resolve(root, requestedPath || '.');
  const relativePath = path.relative(root, absolutePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Path is outside the repository');
  }

  return {
    root,
    absolutePath,
    relativePath: relativePath === '' ? '' : relativePath.split(path.sep).join('/'),
  };
}

async function listRepoDirectory(repoPath: string, requestedPath: string, limit: number) {
  const resolved = resolveRepoChild(repoPath, requestedPath);
  const stat = await fs.promises.stat(resolved.absolutePath);
  if (!stat.isDirectory()) throw new Error('Path is not a directory');

  const dirents = await fs.promises.readdir(resolved.absolutePath, { withFileTypes: true });
  const visible = dirents
    .filter(d => !(d.isDirectory() && DEFAULT_IGNORED_DIRS.has(d.name)))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);

  const entries = await Promise.all(visible.map(async d => {
    const absolute = path.join(resolved.absolutePath, d.name);
    const childStat = await fs.promises.stat(absolute).catch(() => undefined);
    const rel = path.relative(resolved.root, absolute).split(path.sep).join('/');
    return {
      name: d.name,
      path: rel,
      type: d.isDirectory() ? 'directory' : 'file',
      size: childStat?.size ?? 0,
      modifiedAt: childStat?.mtime.toISOString(),
    };
  }));

  return {
    path: resolved.relativePath,
    entries,
    truncated: dirents.length > limit,
  };
}

async function readRepoFile(repoPath: string, requestedPath: string, maxBytes: number) {
  if (!requestedPath) throw new Error('Missing file path');
  const resolved = resolveRepoChild(repoPath, requestedPath);
  const stat = await fs.promises.stat(resolved.absolutePath);
  if (!stat.isFile()) throw new Error('Path is not a file');

  const handle = await fs.promises.open(resolved.absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const contentBuffer = buffer.subarray(0, Math.min(bytesRead, maxBytes));
    const isTruncated = stat.size > maxBytes;
    const isBinary = contentBuffer.includes(0);
    const content = isBinary ? '' : contentBuffer.toString('utf8');

    return {
      path: resolved.relativePath,
      content,
      size: stat.size,
      isBinary,
      isTruncated,
      lineCount: content ? content.split('\n').length : 0,
    };
  } finally {
    await handle.close();
  }
}
