// npm start -> http://localhost:3000
// Local only: the fill scripts drive Chrome on this machine with this user's sign-ins.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig, type AskKind, type Ui } from './browser.ts';
import { entriesFromBytes, type Entry } from './csv.ts';
import { emptyReport, reportFile, summarize, type Report } from './draft-report.ts';
import { runNhr } from './fill-nhr.ts';
import { runReport } from './fill-report.ts';
import { runOdc } from './fill-timesheet.ts';

const PORT = Number(process.env.PORT ?? 3000);
const MONTH = /^\d{4}-\d{2}$/;

let entries: Entry[] = []; // last uploaded CSV
let job: string | null = null;
let events: string[] = []; // current job's events, replayed to a tab that connects late
const listeners = new Set<ServerResponse>();
const pending = new Map<number, (ok: boolean) => void>();
let nextAskId = 1;

function emit(event: object) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  events.push(line);
  for (const res of listeners) res.write(line);
}

const webUi: Ui = {
  log: text => emit({ type: 'log', text }),
  ask: (text: string, kind: AskKind, items?: string[]) =>
    new Promise(resolve => {
      const id = nextAskId++;
      pending.set(id, resolve);
      emit({ type: 'ask', id, kind, text, items });
    }),
};

function startJob(name: string, work: () => Promise<void>) {
  job = name;
  events = [];
  emit({ type: 'start', job: name });
  work()
    .then(() => emit({ type: 'done' }))
    .catch((err: Error) => emit({ type: 'error', text: err.message.split('\n')[0] }))
    .finally(() => {
      job = null;
      for (const resolve of pending.values()) resolve(false);
      pending.clear();
    });
}

async function body(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
const json = async <T>(req: IncomingMessage): Promise<T> => JSON.parse((await body(req)).toString('utf8'));

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Whose report: the person on the loaded CSV for that month, else the name in Settings
function reportTarget(month: string | null) {
  if (!month || !MONTH.test(month)) throw new HttpError(400, 'month must be YYYY-MM');
  const monthEntries = entries.filter(e => e.date.startsWith(month));
  const person = monthEntries[0]?.resource || loadConfig().reporterName;
  return { month, monthEntries, person, path: reportFile(month, person) };
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const key = `${req.method} ${url.pathname}`;

  if (key === 'GET /') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(readFileSync('public/index.html'));
  }

  if (key === 'GET /api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const line of events) res.write(line);
    listeners.add(res);
    req.on('close', () => listeners.delete(res));
    return;
  }

  if (key === 'GET /api/config') return send(res, 200, loadConfig());
  if (key === 'PUT /api/config') {
    const next = { ...loadConfig(), ...(await json<object>(req)) };
    writeFileSync('config.json', JSON.stringify(next, null, 2) + '\n');
    return send(res, 200, next);
  }

  if (key === 'POST /api/csv') {
    try {
      entries = entriesFromBytes(await body(req));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    if (!entries.length) throw new HttpError(400, 'No rows with hours found in this CSV');
    return send(res, 200, { entries });
  }

  if (key === 'GET /api/report') {
    const { monthEntries, person, path } = reportTarget(url.searchParams.get('month'));
    const meta = { path, person, settingsName: loadConfig().reporterName };
    // A saved file (from Save or an AI agent) wins; otherwise start from the CSV summary
    if (existsSync(path)) return send(res, 200, { report: JSON.parse(readFileSync(path, 'utf8')), source: 'saved', ...meta });
    const report = emptyReport(monthEntries[0]?.projectName ?? entries[0]?.projectName);
    if (monthEntries.length) return send(res, 200, { report: { ...report, ...summarize(monthEntries) }, source: 'generated', ...meta });
    return send(res, 200, { report, source: 'empty', ...meta });
  }
  if (key === 'PUT /api/report') {
    const { month, path } = reportTarget(url.searchParams.get('month'));
    mkdirSync(`reports/${month}`, { recursive: true });
    writeFileSync(path, JSON.stringify({ ...emptyReport(), ...(await json<Report>(req)) }, null, 2) + '\n');
    return send(res, 200, { saved: path });
  }
  if (key === 'GET /api/report/summary') {
    const month = url.searchParams.get('month') ?? '';
    const monthEntries = entries.filter(e => e.date.startsWith(month));
    if (!monthEntries.length) throw new HttpError(400, `Load a timesheet CSV for ${month} first`);
    return send(res, 200, summarize(monthEntries));
  }

  if (key === 'POST /api/run') {
    if (job) throw new HttpError(409, `${job} is still running`);
    const { target, include, report } = await json<{ target: string; include?: number[]; report?: Report }>(req);
    if (target === 'report') {
      if (!report) throw new HttpError(400, 'report missing');
      startJob('Monthly Report', () => runReport(report, webUi));
      return send(res, 202, { job });
    }
    const chosen = (include ?? []).map(i => entries[i]).filter(Boolean);
    if (!chosen.length) throw new HttpError(400, 'No rows selected');
    if (target === 'odc') startJob('ODC', () => runOdc(chosen, webUi));
    else if (target === 'nhr') startJob('NHR', () => runNhr(chosen, webUi));
    else throw new HttpError(400, `unknown target ${target}`);
    return send(res, 202, { job });
  }

  if (key === 'POST /api/answer') {
    const { id, ok } = await json<{ id: number; ok: boolean }>(req);
    const resolve = pending.get(id);
    if (!resolve) throw new HttpError(404, 'That question is no longer open');
    pending.delete(id);
    emit({ type: 'answered', id });
    resolve(ok);
    return send(res, 200, {});
  }

  throw new HttpError(404, 'Not found');
}

createServer((req, res) => {
  route(req, res).catch((err: Error) => {
    if (res.headersSent) return res.end();
    send(res, err instanceof HttpError ? err.status : 500, { error: err.message });
  });
})
  .on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE') throw err;
    console.error(`Port ${PORT} is in use; Timesheet Autofill may already be running at http://localhost:${PORT}. Or run: PORT=3001 npm start`);
    process.exit(1);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Timesheet Autofill: http://localhost:${PORT}`));
