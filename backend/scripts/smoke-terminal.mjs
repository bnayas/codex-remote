import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const token = 'smoke-token';
const projectId = 'smoke-project';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

let server;
let tempRoot;
let sessionId;

async function main() {
  const port = await getFreePort();
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-remote-smoke-'));
  const tempHome = path.join(tempRoot, 'home');
  const repoPath = path.join(tempRoot, 'repo');
  await fs.mkdir(path.join(tempHome, '.codex-remote'), { recursive: true });
  await fs.mkdir(repoPath, { recursive: true });

  const agentCommand = process.env.SMOKE_AGENT_COMMAND || 'cat';
  const config = [
    `authToken: ${token}`,
    `port: ${port}`,
    'host: 127.0.0.1',
    'notion:',
    '  syncOnStart: false',
    '  tokenEnv: NOTION_TOKEN',
    'projects:',
    `  - id: ${projectId}`,
    '    name: Smoke Project',
    `    repoPath: ${JSON.stringify(repoPath)}`,
    `    defaultCodexCommand: ${JSON.stringify(agentCommand)}`,
    '    largeFileThresholdKb: 256',
    '',
  ].join('\n');
  await fs.writeFile(path.join(tempHome, '.codex-remote', 'config.yaml'), config);

  server = spawn(process.execPath, ['dist/index.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      NOTION_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLog = [];
  server.stdout.on('data', data => serverLog.push(data.toString()));
  server.stderr.on('data', data => serverLog.push(data.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, serverLog);

  const session = await request(baseUrl, 'POST', '/sessions', {
    projectId,
    title: 'Terminal smoke test',
  });
  sessionId = session.id;
  if (!sessionId) throw new Error('Session response did not include an id');

  const agentMarker = `agent-smoke-${Date.now()}`;
  await expectStreamOutput({
    url: wsUrl(baseUrl, `/sessions/${sessionId}/stream`),
    label: 'agent',
    marker: agentMarker,
    trigger: () => request(baseUrl, 'POST', `/sessions/${sessionId}/input`, { text: agentMarker }),
  });

  const shellMarker = `shell-smoke-${Date.now()}`;
  await expectStreamOutput({
    url: wsUrl(baseUrl, `/sessions/${sessionId}/shell/stream`),
    label: 'shell',
    marker: shellMarker,
    trigger: () => request(baseUrl, 'POST', `/sessions/${sessionId}/shell/input`, {
      text: `printf '${shellMarker}\\n'`,
    }),
  });

  await request(baseUrl, 'POST', `/sessions/${sessionId}/kill-tree`, { confirm: true }).catch(() => {});
  await request(baseUrl, 'POST', `/sessions/${sessionId}/shell/kill-tree`, { confirm: true }).catch(() => {});

  console.log('terminal smoke test passed');
}

function wsUrl(baseUrl, route) {
  return `${baseUrl.replace(/^http/, 'ws')}${route}?token=${encodeURIComponent(token)}`;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, serverLog) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.exitCode !== null) {
      throw new Error(`Backend exited early:\n${lastLog(serverLog)}`);
    }
    try {
      const health = await request(baseUrl, 'GET', '/health');
      if (health.ok) return;
    } catch {
      // Keep polling until the backend accepts connections.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for backend health:\n${lastLog(serverLog)}`);
}

async function request(baseUrl, method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${route} failed (${response.status}): ${text}`);
  }
  return parsed;
}

async function expectStreamOutput({ url, label, marker, trigger }) {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const chunks = [];
    let triggered = false;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for ${label} stream marker ${marker}`));
    }, timeoutMs);

    ws.on('message', raw => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        clearTimeout(timer);
        ws.close();
        reject(err);
        return;
      }

      if (msg.type === 'connected' && !triggered) {
        triggered = true;
        Promise.resolve(trigger()).catch(err => {
          clearTimeout(timer);
          ws.close();
          reject(err);
        });
      }

      if (msg.type === 'output') chunks.push(msg.data);
      if (msg.type === 'agent_json_chunk') chunks.push(msg.content);

      if (chunks.join('').includes(marker)) {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });

    ws.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function lastLog(lines) {
  return lines.join('').split('\n').slice(-40).join('\n');
}

async function cleanup() {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await delay(500);
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(cleanup);
