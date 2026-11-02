import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { chromium, type Page } from 'playwright';

export type Config = { timesheetUrl: string; nhrUrl: string; reportUrl: string; reporterName: string; reporterRole: string };

const EMPTY: Config = { timesheetUrl: '', nhrUrl: '', reportUrl: '', reporterName: '', reporterRole: '' };

// config.json is per user and not in git; the site URLs are shared privately
export function loadConfig(): Config {
  return existsSync('config.json') ? { ...EMPTY, ...JSON.parse(readFileSync('config.json', 'utf8')) } : { ...EMPTY };
}

export function siteUrl(config: Config, key: 'timesheetUrl' | 'nhrUrl' | 'reportUrl', name: string): string {
  if (!config[key]) throw new Error(`Set the ${name} URL in Settings first`);
  return config[key];
}

// continue: Continue / Cancel. confirm: Add / Cancel. done: Close browser.
export type AskKind = 'continue' | 'confirm' | 'done';
export type Ui = {
  log(text: string): void;
  ask(text: string, kind: AskKind, items?: string[]): Promise<boolean>;
};

export const cliUi: Ui = {
  log: text => console.log(text),
  async ask(text, kind, items) {
    for (const i of items ?? []) console.log(`    ${i}`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(kind === 'confirm' ? `${text} (y/N) ` : `${text} Press Enter. `);
      return kind !== 'confirm' || answer.trim().toLowerCase() === 'y';
    } finally {
      rl.close();
    }
  },
};

// The profile keeps login and Cloudflare cookies, so the manual step is usually once.
// Use the same VPN each run: Cloudflare ties its cookie to the IP.
export async function openPage(url: string, prepare: string, ui: Ui): Promise<Page> {
  const ctx = await chromium.launchPersistentContext('.browser-profile', { headless: false, channel: 'chrome', viewport: null });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  try {
    await page.goto(url);
  } catch (err) {
    await ctx.close();
    const unreachable = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_TIMED_OUT|Timeout/.test(String(err));
    throw unreachable ? new Error(`Cannot reach ${new URL(url).host}. Check the VPN for this site.`) : err;
  }
  if (!(await ui.ask(`In the Chrome window: pass Cloudflare / sign in if asked, ${prepare}.`, 'continue'))) {
    await ctx.close();
    throw new Error('Cancelled');
  }
  return page;
}

// Leaves error.png for the user, then rethrows
export async function screenshotOnError(page: Page, err: unknown): Promise<never> {
  await page.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
  throw err;
}

export const entryLine = (e: { date: string; hours: number; task: string }) => `${e.date}  ${e.hours}h  ${e.task}`;

type Line = { date: string; hours: number; task: string };

// Arguments for ui.ask before changing rows; warnings and removals are listed first
export function confirmAdd(site: string, todo: Line[], over: string[], remove: Line[] = []): [string, AskKind, string[]] {
  const warning = over.length ? ` ${over.length} day(s) would go over 8h. Check those dates in the CSV first.` : '';
  const action = remove.length ? `Remove ${remove.length} and add ${todo.length} entries on ${site}?` : `Add ${todo.length} entries to ${site}?`;
  return [`${action}${warning}`, 'confirm', [
    ...over.map(d => `⚠ Over 8h: ${d}`),
    ...remove.map(e => `⚠ Remove: ${entryLine(e)}`),
    ...todo.map(entryLine),
  ]];
}
