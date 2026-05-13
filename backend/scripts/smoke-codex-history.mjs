import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-history-smoke-'));

try {
  const codexHome = path.join(tempRoot, '.codex');
  const repoPath = path.join(tempRoot, 'repo');
  const otherRepoPath = path.join(tempRoot, 'other-repo');
  await fs.mkdir(path.join(codexHome, 'sessions', '2026', '05', '13'), { recursive: true });
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(otherRepoPath, { recursive: true });

  const matchingId = '019e22b7-b0a3-7e50-a1bd-db2f7738a676';
  const otherId = '019e22bb-2f2c-7b53-98d5-7773002332c9';

  await fs.writeFile(path.join(codexHome, 'session_index.jsonl'), [
    JSON.stringify({
      id: matchingId,
      thread_name: 'Fix remote session history',
      updated_at: '2026-05-13T19:05:56.208517Z',
    }),
    JSON.stringify({
      id: otherId,
      thread_name: 'Unrelated repo work',
      updated_at: '2026-05-13T18:00:00.000000Z',
    }),
    '',
  ].join('\n'));

  await writeSessionMeta(codexHome, matchingId, repoPath, '2026-05-13T19:02:04.195Z');
  await writeSessionMeta(codexHome, otherId, otherRepoPath, '2026-05-13T18:00:00.000Z');

  process.env.CODEX_HOME = codexHome;
  const { listCodexConversationsForRepo } = await import('../dist/codexHistory.js');
  const conversations = await listCodexConversationsForRepo(repoPath);

  if (conversations.length !== 1) {
    throw new Error(`Expected one matching conversation, got ${conversations.length}`);
  }
  if (conversations[0].id !== matchingId) {
    throw new Error(`Expected ${matchingId}, got ${conversations[0].id}`);
  }
  if (conversations[0].threadName !== 'Fix remote session history') {
    throw new Error(`Unexpected thread name: ${conversations[0].threadName}`);
  }

  console.log('codex history smoke test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function writeSessionMeta(codexHome, id, cwd, timestamp) {
  const filePath = path.join(
    codexHome,
    'sessions',
    '2026',
    '05',
    '13',
    `rollout-2026-05-13T22-02-04-${id}.jsonl`
  );
  await fs.writeFile(filePath, JSON.stringify({
    timestamp,
    type: 'session_meta',
    payload: {
      id,
      timestamp,
      cwd,
      source: 'vscode',
      cli_version: '0.130.0-alpha.5',
    },
  }) + '\n');
}
