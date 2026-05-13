import Fastify from 'fastify';
import FastifyWS from '@fastify/websocket';
import FastifyCors from '@fastify/cors';
import { loadConfig } from './config';
import { initDb, upsertProject, markStaleSessionsUnknown, getAllProjects } from './db';
import { setAuthToken, authHook } from './auth';
import { registerRoutes } from './routes/api';
import { registerWsRoutes } from './ws/stream';
import { startScheduler } from './scheduler';
import { syncProjectsFromNotion } from './notion';
import { loadBackendEnv } from './env';

async function main() {
  const loadedEnv = loadBackendEnv();
  if (loadedEnv > 0) {
    console.log(`✓ Loaded ${loadedEnv} backend .env value${loadedEnv === 1 ? '' : 's'}`);
  }

  const config = loadConfig();

  // Initialize database
  initDb();

  // Mark any sessions that were running as unknown (backend restart)
  markStaleSessionsUnknown();

  // Start the background scheduler
  startScheduler(60000);

  // Sync projects from config into DB as bootstrap/fallback.
  for (const p of config.projects) {
    upsertProject({
      id: p.id,
      name: p.name,
      repoPath: p.repoPath,
      defaultCodexCommand: p.defaultCodexCommand,
      notionProjectId: p.notionProjectId,
      githubUrl: p.githubUrl,
      largeFileThresholdKb: p.largeFileThresholdKb,
    });
  }

  if (config.notion.syncOnStart) {
    try {
      const result = await syncProjectsFromNotion(config);
      if (result.enabled) {
        console.log(`✓ Synced ${result.synced} Notion projects (${result.skipped} skipped)`);
      } else {
        console.log(`Notion project sync skipped: ${result.reason}`);
      }
    } catch (err) {
      console.warn('Notion project sync failed:', (err as Error).message);
    }
  }

  // Setup auth
  setAuthToken(config.authToken);

  // Create Fastify app
  const app = Fastify({
    logger: {
      level: 'info',
      transport: { target: 'pino-pretty', options: { colorize: true } },
    },
  });

  await app.register(FastifyCors, {
    origin: true,
    credentials: true,
  });

  await app.register(FastifyWS);

  // Auth hook on all routes
  app.addHook('preHandler', authHook);

  // Register routes
  await registerRoutes(app, config);
  await registerWsRoutes(app);

  // Start listening
  const host = config.host || '0.0.0.0';
  const port = config.port || 3742;

  await app.listen({ host, port });

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║         Codex Remote — Backend Ready         ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  HTTP/WS  : http://${host}:${port}`);
  console.log(`║  Auth     : Bearer ${config.authToken.slice(0, 8)}...`);
  console.log(`║  Projects : ${getAllProjects().length} available`);
  console.log('╚══════════════════════════════════════════════╝\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
