import express from 'express';

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

app.get('/api/session', (_request, response) => {
  response.json({
    data: {
      phase: '準備中',
      questionCount: 0,
      groupCount: 0,
      serverTime: new Date().toISOString(),
    },
  });
});

app.listen(port, host, () => {
  console.log(`Answering System server listening on ${host}:${port}`);
});
