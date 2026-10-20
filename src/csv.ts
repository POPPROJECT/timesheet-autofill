import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export type Entry = {
  date: string; // YYYY-MM-DD
  projectId: string;
  projectName: string;
  task: string;
  hours: number;
  remark: string;
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// SharePoint "Download as CSV" writes Windows-1252, not UTF-8
export function decode(buf: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

const MDY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function toEntries(rows: string[][]): Entry[] {
  const headerAt = rows.findIndex(r => r[0]?.trim().startsWith('Date'));
  if (headerAt < 0) throw new Error('Header row starting with "Date" not found');
  const header = rows[headerAt].map(s => s.trim());
  const col = (prefix: string) => {
    const i = header.findIndex(h => h.startsWith(prefix));
    if (i < 0) throw new Error(`Column "${prefix}" not found in header`);
    return i;
  };
  const c = { date: col('Date'), id: col('Project ID'), name: col('Project Name'), task: col('Activity'), hours: col('Hours'), remark: col('Remarks') };

  const entries: Entry[] = [];
  for (const [n, r] of rows.slice(headerAt + 1).entries()) {
    const m = MDY.exec(r[c.date]?.trim() ?? '');
    const task = r[c.task]?.trim();
    const rawHours = r[c.hours]?.trim();
    if (!m || !task || !rawHours) continue; // footer rows and days not filled in yet
    const hours = Number(rawHours);
    if (!(hours > 0)) throw new Error(`Row ${headerAt + n + 2}: bad hours "${rawHours}"`);
    entries.push({
      date: `${m[3]}-${m[1]}-${m[2]}`,
      projectId: r[c.id].trim(),
      projectName: r[c.name].trim(),
      task,
      hours,
      remark: r[c.remark]?.trim() ?? '',
    });
  }
  return entries;
}

export const entriesFromBytes = (buf: Uint8Array) => toEntries(parseCsv(decode(buf)));
export const readEntries = (path: string) => entriesFromBytes(readFileSync(path));

export const entryKey = (date: string, task: string, hours: number) => `${date}|${task.trim()}|${hours}`;

// Entries not yet on the site. A multiset, so a task logged twice on one day needs two rows there.
export function missing(entries: Entry[], siteKeys: string[]): Entry[] {
  const left = new Map<string, number>();
  for (const k of siteKeys) left.set(k, (left.get(k) ?? 0) + 1);
  return entries.filter(e => {
    const k = entryKey(e.date, e.task, e.hours);
    const n = left.get(k) ?? 0;
    if (n) left.set(k, n - 1);
    return !n;
  });
}

export function printByDay(entries: Entry[]) {
  for (const [day, list] of Map.groupBy(entries, e => e.date)) {
    const total = list.reduce((s, e) => s + e.hours, 0);
    console.log(`${day}  ${total}h${total === 8 ? '' : '  <-- not 8h'}`);
    for (const e of list) console.log(`    ${e.hours.toFixed(2)}h  ${e.remark.padEnd(6)}  ${e.task}`);
  }
}

// <timesheet.csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]
export function entriesFromArgs() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { from: { type: 'string' }, to: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  });
  if (!positionals[0]) throw new Error('Usage: <timesheet.csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]');
  const all = readEntries(positionals[0]);
  const from = values.from ?? all[0].date;
  const to = values.to ?? all.at(-1)!.date;
  const entries = all.filter(e => e.date >= from && e.date <= to);
  return { entries, from, to, dryRun: values['dry-run'] ?? false };
}

// Days that pass 8h once the new rows are added to what the site already has; usually a row with the wrong date
export function overDays(site: { date: string; hours: number }[], todo: Entry[]): string[] {
  const sum = (list: { hours: number }[]) => list.reduce((s, e) => s + e.hours, 0);
  return [...new Set(todo.map(e => e.date))].sort().flatMap(date => {
    const there = sum(site.filter(e => e.date === date));
    const added = sum(todo.filter(e => e.date === date));
    return there + added > 8 ? [`${date}: ${there}h already there + ${added}h new = ${there + added}h`] : [];
  });
}
