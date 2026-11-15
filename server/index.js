import express from 'express';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDevelopmentGroupSeed, createGroupsEntry, InvalidGroupsError } from './groups-entry.js';

function isLoopback(address = '') {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1' || normalized === '127.0.0.1' || normalized.startsWith('127.');
}

function loopbackOnly(request, response, next) {
  if (!isLoopback(request.socket.remoteAddress)) {
    return response.status(403).json({
      error: { code: 'LOOPBACK_ONLY', message: '此操作僅允許本機呼叫。' },
    });
  }
  next();
}

export function createApplication({ environment = process.env.NODE_ENV, exposeTestErrorRoute = false } = {}) {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  const isDevelopment = environment === 'development';
  const groups = createGroupsEntry({ seed: isDevelopment ? createDevelopmentGroupSeed() : [] });
  const session = { phase: '準備中', questions: [], groups };
  const eventClients = new Set();

  function sessionSummary() {
    return {
      phase: session.phase,
      questionCount: session.questions.length,
      groupCount: session.groups.count(),
      serverTime: new Date().toISOString(),
    };
  }

  function publishPhase() {
    const payload = JSON.stringify({ phase: session.phase, serverTime: new Date().toISOString() });
    for (const response of eventClients) response.write(`event: phase\ndata: ${payload}\n\n`);
  }

  app.get('/api/session', (_request, response) => {
    response.json({ data: sessionSummary() });
  });

  app.get('/api/groups', (_request, response) => {
    response.json({ data: { groups: session.groups.list() } });
  });

  function configureGroups(request, response, operation) {
    if (!isLoopback(request.socket.remoteAddress)) {
      return response.status(403).json({
        error: { code: 'LOOPBACK_ONLY', message: '此操作僅允許本機呼叫。' },
      });
    }
    if (session.phase !== '準備中') {
      return response.status(409).json({
        error: { code: 'GROUP_CONFIG_NOT_ALLOWED', message: '僅能在準備中設定組別。' },
      });
    }
    try {
      const result = operation();
      return response.json({ data: { groups: result } });
    } catch (error) {
      if (error instanceof InvalidGroupsError) {
        return response.status(400).json({ error: { code: 'INVALID_GROUPS', message: error.message } });
      }
      throw error;
    }
  }

  app.put('/api/groups', (request, response) => configureGroups(request, response, () => session.groups.replace(request.body?.groups)));
  app.post('/api/groups/generate', (request, response) => configureGroups(request, response, () => session.groups.generate(request.body?.count)));

  if (exposeTestErrorRoute) {
    app.get('/api/__test__/error', () => {
      throw new Error('test-only-secret-marker');
    });
  }

  app.get('/api/events', (request, response) => {
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write('retry: 3000\n\n');
    eventClients.add(response);

    const heartbeat = setInterval(() => {
      response.write(`event: heartbeat\ndata: ${JSON.stringify({ serverTime: new Date().toISOString() })}\n\n`);
    }, 15_000);
    request.on('close', () => {
      clearInterval(heartbeat);
      eventClients.delete(response);
    });
  });

  app.post('/api/session/start', loopbackOnly, (_request, response) => {
    if (session.phase !== '準備中') {
      return response.status(409).json({
        error: { code: 'INVALID_PHASE_TRANSITION', message: '目前階段不能開啟搶答。' },
      });
    }
    session.phase = '搶答中';
    publishPhase();
    response.json({ data: { phase: session.phase, serverTime: new Date().toISOString() } });
  });

  app.post('/api/session/end', loopbackOnly, (_request, response) => {
    if (session.phase !== '搶答中') {
      return response.status(409).json({
        error: { code: 'INVALID_PHASE_TRANSITION', message: '目前階段不能結束搶答。' },
      });
    }
    session.phase = '已結束';
    publishPhase();
    response.json({ data: { phase: session.phase, serverTime: new Date().toISOString() } });
  });

  if (isDevelopment) {
    session.questions = Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      prompt: `開發測試題目 ${index + 1}`,
    }));
    app.post('/api/dev/phase/:phase', loopbackOnly, (request, response) => {
      const phases = ['準備中', '搶答中', '已結束'];
      if (!phases.includes(request.params.phase)) {
        return response.status(400).json({
          error: { code: 'INVALID_PHASE', message: '指定的活動階段無效。' },
        });
      }
      session.phase = request.params.phase;
      publishPhase();
      response.json({ data: sessionSummary() });
    });
  }

  app.use('/api', (_request, response) => {
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: '找不到此 API 路徑。' },
    });
  });

  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.parse.failed') {
      return response.status(400).json({
        error: { code: 'INVALID_JSON', message: 'JSON 格式錯誤或請求欄位無效。' },
      });
    }
    if (error.type === 'entity.too.large') {
      return response.status(413).json({
        error: { code: 'BODY_TOO_LARGE', message: 'JSON body 超過 16 KiB 上限。' },
      });
    }
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '伺服器發生未預期錯誤。' },
    });
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  createApplication().listen(port, host, () => {
    console.log(`Answering System server listening on ${host}:${port}`);
  });
}
