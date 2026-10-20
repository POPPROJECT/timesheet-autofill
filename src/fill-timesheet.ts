// npm run timesheet -- <timesheet.csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]
// Adds entries missing from the ODC timesheet. Never presses the month's Submit button.
import type { Page } from 'playwright';
import { cliUi, confirmAdd, entryLine, loadConfig, openPage, screenshotOnError, siteUrl, type Ui } from './browser.ts';
import { entriesFromArgs, entryKey, missing, overDays, printByDay, type Entry } from './csv.ts';

export async function runOdc(entries: Entry[], ui: Ui) {
  const dates = entries.map(e => e.date).sort();
  const [from, to] = [dates[0], dates.at(-1)!];
  const config = loadConfig();
  const baseUrl = siteUrl(config, 'timesheetUrl', 'ODC timesheet');

  type SiteRow = { date: string; task: string; hours: number };
  const keys = (rows: SiteRow[]) => rows.map(r => entryKey(r.date, r.task, r.hours));

  // Same API the page uses
  async function siteRows(page: Page): Promise<SiteRow[]> {
    const url = new URL(`/api/timesheets?from=${from}&to=${to}`, baseUrl);
    const res = await page.request.get(url.href);
    if (!res.ok()) throw new Error(`GET ${url.pathname} -> ${res.status()}; are you signed in?`);
    const body = (await res.json()) as { entries: { date: string; task_description: string; hours: number }[] };
    return body.entries.map(e => ({ date: e.date, task: e.task_description, hours: e.hours }));
  }

  const page = await openPage(baseUrl, `show ${from.slice(0, 7)}`, ui);
  try {
    const site = await siteRows(page);
    const todo = missing(entries, keys(site));
    ui.log(`${entries.length - todo.length} already on ODC, ${todo.length} to add.`);
    if (todo.length && (await ui.ask(...confirmAdd('ODC', todo, overDays(site, todo))))) {
      for (const e of todo) {
        const card = page.locator(`#tsday-${e.date}`);
        // fields found by their labels: ODC has already changed placeholders once
        const field = (label: string) => card.locator('.field').filter({ has: page.locator('.field-label', { hasText: label }) });
        await card.getByRole('button', { name: 'Add entry' }).click();
        await card.getByRole('combobox', { name: 'Project' }).fill(e.projectId);
        await card.getByRole('option').filter({ hasText: e.projectId }).first().click();
        await field('Hours').locator('input').fill(String(e.hours));
        await field('Remark').locator('input').fill(e.remark);
        const task = field('Task description').locator('textarea');
        await task.fill(e.task);
        await card.getByRole('button', { name: 'Save', exact: true }).click();
        await task.waitFor({ state: 'detached' });
        ui.log(`added ${entryLine(e)}`);
      }
      const still = missing(entries, keys(await siteRows(page)));
      ui.log(still.length ? `Still missing ${still.length}:\n${still.map(entryLine).join('\n')}` : 'All entries are on ODC.');
    }
    await ui.ask('Check the page. Submit the month yourself when ready.', 'done');
  } catch (err) {
    await screenshotOnError(page, err);
  } finally {
    await page.context().close();
  }
}

if (import.meta.main) {
  const { entries, dryRun } = entriesFromArgs();
  printByDay(entries);
  if (!dryRun) await runOdc(entries, cliUi);
}
