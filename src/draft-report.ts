// Draft reports/YYYY-MM.json from the timesheet CSV. Key Highlights is pre-filled;
// edit it and fill the other sections by hand before running fill-report.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readEntries, type Entry } from './csv.ts';

export type Report = {
  projectName: string; // must match an option in the report site's project dropdown
  keyHighlights: string[];
  upcomingFocus: string[];
  issues: string[];
  concerns: string[];
  risks: string[];
  needSupport: string[];
};

const SECTIONS: [title: string, match: (task: string) => boolean][] = [
  ['Frontend', t => t.includes('[FE]')],
  ['Backend', t => t.includes('[BE]')],
  ['Meetings & Scrum', t => t.startsWith('[')],
  ['Documents & Others', () => true],
];

// One short line per section, ticket keys only: a starting point to rewrite by feature
export function highlights(entries: Entry[]): string[] {
  const groups = SECTIONS.map(([title]) => ({ title, hours: 0, items: new Set<string>() }));
  for (const e of entries) {
    const g = groups[SECTIONS.findIndex(([, match]) => match(e.task))];
    g.hours += e.hours;
    g.items.add(/^EAPM-\d+/.exec(e.task)?.[0] ?? e.task.replace(/^\[[^\]]*\]:?\s*/, ''));
  }
  return groups.filter(g => g.items.size).map(g => `${g.title} (${g.hours}h): ${[...g.items].join(', ')}`);
}

if (import.meta.main) {
  const csv = process.argv[2];
  if (!csv) throw new Error('Usage: npm run draft -- <timesheet.csv>');
  const entries = readEntries(csv);
  const month = entries[0].date.slice(0, 7);
  const out = `reports/${month}.json`;
  if (existsSync(out)) throw new Error(`${out} exists; delete it to redraft`);

  const report: Report = { projectName: entries[0].projectName, keyHighlights: highlights(entries), upcomingFocus: [], issues: [], concerns: [], risks: [], needSupport: [] };
  mkdirSync('reports', { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${out}`);
}
