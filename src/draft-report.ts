// Monthly Report type and the rule-based summary of a month's timesheet.
// npm run draft -- <timesheet.csv>  writes reports/YYYY-MM/<name>.json from the summary.
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

// unless: a task matching it does not count for this rule (keeps testing work out of the developer lines)
type Rule = { match: RegExp; unless?: RegExp; text: string };
const TESTING = /\b(test(s|ed|ing)?|qa|uat|regression|automation|test ?cases?|verif(y|ied|ication))\b/i;

// A line is used when any task in the month matches its pattern, in this order.
// Edit the wording or patterns here to change the generated report.
export const HIGHLIGHT_RULES: Rule[] = [
  { match: /\[(FE|BE|API)\]|\b(develop|build|implement|integrate|create)\b/i, unless: TESTING,
    text: "Developed and updated application features based on the team's planned work." },
  { match: /layout|table|grid|menu|sidebar|card|chart|page|dropdown|avatar|filter|search/i, unless: TESTING,
    text: 'Improved page layouts, navigation menus, data tables and charts to make information easier to access and review.' },
  { match: /\[(BE|API)\]|\b(api|service|schema|migration|database)\b/i, unless: TESTING,
    text: 'Built and enhanced backend services and data handling to support the application features.' },
  { match: TESTING,
    text: 'Tested application features, prepared and ran test cases, and verified fixes to support release quality.' },
  { match: /\b(fix|bug|defect|error|issue|required)\b/i, unless: TESTING,
    text: 'Fixed issues affecting data entry and information display, and improved code quality to support ongoing maintenance.' },
  { match: /meeting|stand ?up|sprint|grooming|retro|planning|estimat|backlog/i,
    text: 'Contributed to team planning, task estimation and progress reviews.' },
  { match: /document|\bucr\b|\bpcr\b|deploy|release/i,
    text: 'Prepared supporting documentation and participated in system release activities.' },
];

export const FOCUS_RULES: Rule[] = [
  { match: /\[(FE|BE|API)\]|\b(develop|build|implement|integrate|create)\b/i, unless: TESTING,
    text: "Continue developing and improving application features based on the team's planned work." },
  { match: TESTING,
    text: 'Continue testing upcoming features and support user acceptance testing.' },
  { match: /./,
    text: 'Continue resolving application issues and improving usability and code quality.' },
  { match: /meeting|sprint|grooming|planning|estimat|backlog/i,
    text: 'Work with the team to review upcoming requirements, refine task estimates and plan development activities.' },
];

export function summarize(entries: Entry[]): Pick<Report, 'keyHighlights' | 'upcomingFocus'> {
  const tasks = entries.map(e => e.task);
  const pick = (rules: Rule[]) => rules.filter(r => tasks.some(t => r.match.test(t) && !r.unless?.test(t))).map(r => r.text);
  return { keyHighlights: pick(HIGHLIGHT_RULES), upcomingFocus: pick(FOCUS_RULES) };
}

// One file per person per month, so two people's reports never mix on a shared machine
export const reportFile = (month: string, person: string) =>
  `reports/${month}/${person.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'me'}.json`;

export const emptyReport = (projectName = ''): Report =>
  ({ projectName, keyHighlights: [], upcomingFocus: [], issues: [], concerns: [], risks: [], needSupport: [] });

if (import.meta.main) {
  const csv = process.argv[2];
  if (!csv) throw new Error('Usage: npm run draft -- <timesheet.csv>');
  const entries = readEntries(csv);
  const month = entries[0].date.slice(0, 7);
  const out = reportFile(month, entries[0].resource);
  if (existsSync(out)) throw new Error(`${out} exists; delete it to redraft`);

  const report: Report = { ...emptyReport(entries[0].projectName), ...summarize(entries) };
  mkdirSync(`reports/${month}`, { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`Wrote ${out}`);
}
