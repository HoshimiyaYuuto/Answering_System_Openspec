import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const isDevelopment = process.env.NODE_ENV === 'development';

const session = {
  phase: '準備中',
  questions: [],
  groups: [],
};

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

function sessionSummary() {
  return {
    phase: session.phase,
    questionCount: session.questions.length,
    groupCount: session.groups.length,
    serverTime: new Date().toISOString(),
  };
}

app.get('/api/session', (_request, response) => {
  response.json({ data: sessionSummary() });
});

app.post('/api/session/start', loopbackOnly, (_request, response) => {
  if (session.phase !== '準備中') {
    return response.status(409).json({
      error: { code: 'INVALID_PHASE_TRANSITION', message: '目前階段不能開啟搶答。' },
    });
  }
  session.phase = '搶答中';
  response.json({ data: { phase: session.phase, serverTime: new Date().toISOString() } });
});

app.post('/api/session/end', loopbackOnly, (_request, response) => {
  if (session.phase !== '搶答中') {
    return response.status(409).json({
      error: { code: 'INVALID_PHASE_TRANSITION', message: '目前階段不能結束搶答。' },
    });
  }
  session.phase = '已結束';
  response.json({ data: { phase: session.phase, serverTime: new Date().toISOString() } });
});

if (isDevelopment) {
  session.questions = Array.from({ length: 50 }, (_, index) => ({
    id: index + 1,
    prompt: `開發測試題目 ${index + 1}`,
  }));
  session.groups = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    name: `第 ${index + 1} 組`,
  }));

  app.post('/api/dev/phase/:phase', loopbackOnly, (request, response) => {
    const phases = ['準備中', '搶答中', '已結束'];
    if (!phases.includes(request.params.phase)) {
      return response.status(400).json({
        error: { code: 'INVALID_PHASE', message: '指定的活動階段無效。' },
      });
    }
    session.phase = request.params.phase;
    response.json({ data: sessionSummary() });
  });
}

app.listen(port, host, () => {
  console.log(`Answering System server listening on ${host}:${port}`);
});
