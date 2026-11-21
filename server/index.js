import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDevelopmentGroupSeed, createGroupsEntry, InvalidGroupsError } from './groups-entry.js';
import {
  createGuidedNotesImport,
  downloadGuidedNotes,
  GuidedNotesImportError,
  MAX_GUIDED_NOTES_BYTES,
  parseGuidedNotes,
} from './guided-notes-import.js';
import { createTeacherAuth, TeacherAuthError } from './teacher-auth.js';
import { createSubmissions } from './submissions.js';

const TEACHER_COOKIE = 'teacher_session';

function readCookie(request, name) {
  const header = request.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

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

function decodeFileName(header) {
  const fallback = '上傳的檔案.xlsx';
  if (!header) return fallback;
  try {
    return decodeURIComponent(header).trim().slice(0, 200) || fallback;
  } catch {
    return fallback;
  }
}

export function createApplication({
  environment = process.env.NODE_ENV,
  exposeTestErrorRoute = false,
  downloadGuidedNotesImpl = downloadGuidedNotes,
  teacherPassword = process.env.TEACHER_PASSWORD,
  now,
} = {}) {
  const app = express();
  const publicRoot = resolve('public');
  app.use('/api', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/', (_request, response) => response.redirect('/student/'));
  app.use('/student', express.static(resolve(publicRoot, 'student')));
  app.use('/teacher', express.static(resolve(publicRoot, 'teacher')));
  app.use(express.json({ limit: '16kb' }));
  const isDevelopment = environment === 'development';
  const groups = createGroupsEntry({ seed: isDevelopment ? createDevelopmentGroupSeed() : [] });
  const developmentQuestions = isDevelopment ? Array.from({ length: 50 }, (_, index) => {
    const id = index + 1;
    const blanks = [10, 20, 30, 40, 50].includes(id)
      ? [{ index: 0, prefix: '（1）', prompt: `第 ${id} 題第一空` }, { index: 1, prefix: '（2）', prompt: `第 ${id} 題第二空` }]
      : [{ index: 0, prefix: '', prompt: `第 ${id} 題` }];
    return { id, prompt: blanks.map(({ prefix, prompt }) => `${prefix}${prompt}`).join(''), blanks };
  }) : [];
  const session = { phase: '準備中', questions: developmentQuestions, groups };
  const submissions = createSubmissions();
  const guidedNotes = createGuidedNotesImport();
  const teacherAuth = createTeacherAuth({ password: teacherPassword, ...(now ? { now } : {}) });
  const eventClients = new Set();

  function isTeacher(request) {
    return teacherAuth.isValid(readCookie(request, TEACHER_COOKIE));
  }

  function requireTeacher(request, response, next) {
    if (!isTeacher(request)) {
      return response.status(401).json({
        error: { code: 'TEACHER_AUTH_REQUIRED', message: '請先以老師密碼登入。' },
      });
    }
    next();
  }

  app.get('/api/teacher/auth', (request, response) => {
    response.json({
      data: { authenticated: isTeacher(request), passwordConfigured: teacherAuth.isConfigured() },
    });
  });

  app.post('/api/teacher/login', (request, response) => {
    try {
      const { token } = teacherAuth.login(request.body?.password, request.socket.remoteAddress);
      response.set('Set-Cookie', `${TEACHER_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return response.json({ data: { authenticated: true } });
    } catch (error) {
      if (!(error instanceof TeacherAuthError)) throw error;
      return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
  });

  app.post('/api/teacher/logout', (request, response) => {
    teacherAuth.logout(readCookie(request, TEACHER_COOKIE));
    response.set('Set-Cookie', `${TEACHER_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    response.json({ data: { authenticated: false } });
  });

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

  app.put('/api/groups', requireTeacher, (request, response) => configureGroups(request, response, () => session.groups.replace(request.body?.groups)));
  app.post('/api/groups/generate', requireTeacher, (request, response) => configureGroups(request, response, () => session.groups.generate(request.body?.count)));

  app.put('/api/student/entry', (request, response) => {
    const result = session.groups.enter(request.body?.studentId, request.body?.groupId, session.phase);
    if (result.error) {
      const { status, ...error } = result.error;
      return response.status(status).json({ error });
    }
    response.json({ data: result.data });
  });

  app.get('/api/student/entry', (request, response) => {
    const result = session.groups.lookup(request.query.studentId, session.phase);
    if (result.error) {
      const { status, ...error } = result.error;
      return response.status(status).json({ error });
    }
    response.json({ data: result.data });
  });

  function lookupStudentEntry(studentId, response) {
    if (typeof studentId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(studentId)) {
      response.status(400).json({ error: { code: 'INVALID_STUDENT_ID', message: 'studentId 格式無效。' } });
      return null;
    }
    const entry = session.groups.lookup(studentId, session.phase);
    if (entry.error) {
      const { status, ...error } = entry.error;
      response.status(status).json({ error });
      return null;
    }
    if (!entry.data.valid) {
      response.status(403).json({ error: { code: 'STUDENT_NOT_ENTERED', message: '學生沒有有效進場紀錄。' } });
      return null;
    }
    return entry.data;
  }

  app.get('/api/student/questions', (request, response) => {
    if (!lookupStudentEntry(request.query.studentId, response)) return;
    if (session.phase === '準備中') {
      return response.status(409).json({ error: { code: 'QUESTIONS_NOT_AVAILABLE', message: '搶答開始後才能讀取題目。' } });
    }
    return response.json({ data: { questions: session.questions.map(({ id, blanks }) => ({
      id,
      blanks: blanks.map(({ index, prefix, prompt }) => ({ index, prefix, prompt })),
    })) } });
  });

  app.post('/api/student/submissions', (request, response) => {
    const entry = lookupStudentEntry(request.body?.studentId, response);
    if (!entry) return;
    if (session.phase !== '搶答中') {
      return response.status(409).json({ error: { code: 'SUBMISSION_NOT_ALLOWED', message: '目前階段不允許提交答案。' } });
    }
    const question = session.questions.find(({ id }) => id === request.body?.questionId);
    if (!question) {
      return response.status(404).json({ error: { code: 'QUESTION_NOT_FOUND', message: '找不到指定題目。' } });
    }
    const result = submissions.submit({ questionId: question.id, groupId: entry.group.id, answers: request.body?.answers, blanksCount: question.blanks.length });
    if (!result.ok) {
      const status = result.code === 'INVALID_ANSWER' ? 400 : 409;
      const message = result.code === 'INVALID_ANSWER' ? '答案格式無效。' : '此組已提交本題答案。';
      return response.status(status).json({ error: { code: result.code, message } });
    }
    return response.status(200).json({ data: { questionId: result.submission.questionId, submittedAt: result.submission.submittedAt } });
  });

  app.get('/api/student/submissions', (request, response) => {
    const entry = lookupStudentEntry(request.query.studentId, response);
    if (!entry) return;
    const ownSubmissions = submissions.listByGroup(entry.group.id).map(({ questionId, answers, submittedAt }) => ({ questionId, answers, submittedAt }));
    return response.json({ data: { submissions: ownSubmissions } });
  });

  function guidedNotesPhaseGuard(_request, response, next) {
    if (session.phase !== '準備中') {
      return response.status(409).json({
        error: { code: 'IMPORT_NOT_ALLOWED', message: '只能在準備中匯入學習單。' },
      });
    }
    next();
  }

  function sendImportError(response, error) {
    if (!(error instanceof GuidedNotesImportError)) throw error;
    return response.status(error.status).json({ error: { code: error.code, message: error.message } });
  }

  async function createImportPreview(response, fileBuffer, source) {
    try {
      const parsed = await parseGuidedNotes(fileBuffer);
      const preview = guidedNotes.createPreview({
        parsed,
        source,
        fileBuffer,
        replacesExisting: session.questions.length > 0,
      });
      return response.json({ data: preview });
    } catch (error) {
      return sendImportError(response, error);
    }
  }

  const rawWorkbook = express.raw({
    type: ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    limit: MAX_GUIDED_NOTES_BYTES,
  });

  app.post(
    '/api/teacher/guided-notes/preview/file',
    requireTeacher,
    guidedNotesPhaseGuard,
    rawWorkbook,
    (request, response) => {
      const fileBuffer = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      return createImportPreview(response, fileBuffer, { type: 'file', name: decodeFileName(request.get('X-File-Name')) });
    },
    (error, _request, response, next) => {
      if (error.type !== 'entity.too.large') return next(error);
      return response.status(413).json({
        error: { code: 'IMPORT_FILE_TOO_LARGE', message: '檔案超過 5 MiB 上限。' },
      });
    },
  );

  app.post('/api/teacher/guided-notes/preview/link', requireTeacher, guidedNotesPhaseGuard, async (request, response) => {
    let download;
    try {
      download = await downloadGuidedNotesImpl(request.body?.url);
    } catch (error) {
      return sendImportError(response, error);
    }
    return createImportPreview(response, download.buffer, { type: 'link', name: download.name });
  });

  app.post('/api/teacher/guided-notes/confirm', requireTeacher, guidedNotesPhaseGuard, (request, response) => {
    try {
      const { questions, summary } = guidedNotes.confirm(request.body?.previewId);
      session.questions = questions;
      return response.json({ data: { current: summary } });
    } catch (error) {
      return sendImportError(response, error);
    }
  });

  app.get('/api/teacher/guided-notes', requireTeacher, (_request, response) => {
    response.json({ data: { current: guidedNotes.currentSummary() } });
  });

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

  app.post('/api/session/start', requireTeacher, (_request, response) => {
    if (session.phase !== '準備中') {
      return response.status(409).json({
        error: { code: 'INVALID_PHASE_TRANSITION', message: '目前階段不能開啟搶答。' },
      });
    }
    if (session.groups.count() === 0) {
      return response.status(409).json({ error: { code: 'NO_GROUPS', message: '請先設定組別。' } });
    }
    if (session.questions.length === 0) {
      return response.status(409).json({ error: { code: 'QUESTIONS_REQUIRED', message: '請先匯入學習單。' } });
    }
    session.phase = '搶答中';
    publishPhase();
    response.json({ data: { phase: session.phase, serverTime: new Date().toISOString() } });
  });

  app.post('/api/session/end', requireTeacher, (_request, response) => {
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
  if (existsSync('.env')) process.loadEnvFile('.env');
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  createApplication().listen(port, host, () => {
    console.log(`Answering System server listening on ${host}:${port}`);
  });
}
