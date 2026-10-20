// npm run nhr -- <timesheet.csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]
// Adds entries missing from the Extosoft NHR timesheet, saving the draft after each day.
// Never presses Submit.
import type { Locator, Page } from 'playwright';
import { cliUi, confirmAdd, entryLine, loadConfig, openPage, screenshotOnError, siteUrl, type Ui } from './browser.ts';
import { entriesFromArgs, entryKey, missing, overDays, printByDay, type Entry } from './csv.ts';

// CSV Remarks column -> NHR Type
export const NHR_TYPE: Record<string, string> = { WFH: 'WFH', ONSITE: 'Onsite' };
const DAY_START = '08:00';
const LUNCH = [12 * 60, 13 * 60]; // NHR leaves this hour out of Work Hours

type Task = { taskName: string; startTime: string; endTime: string; hours: number };
type Month = { period: string; dailyLogs: { date: string; tasks: Task[] }[] };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function period(start: number, hours: number): [number, number] {
  if (start >= LUNCH[0] && start < LUNCH[1]) start = LUNCH[1];
  let end = start + Math.round(hours * 60);
  if (start < LUNCH[0] && end > LUNCH[0]) end += LUNCH[1] - LUNCH[0];
  return [start, end];
}

async function showDay(page: Page, date: string): Promise<Locator> {
  const add = page.locator(`[data-task-add-date="${date}"]`);
  const pages = page.locator('.daily-timesheet-pagination').getByRole('button', { name: /^\d+$/ });
  for (let i = 0; !(await add.count()); i++) {
    if (i >= (await pages.count())) throw new Error(`Day ${date} not found on any page`);
    await pages.nth(i).click();
    // day cards re-render in the same pass that marks the page button active
    await pages.nth(i).and(page.locator('.is-active')).waitFor();
  }
  return add;
}

async function setTime(row: Locator, field: 'periodStart' | 'periodEnd', value: string) {
  const input = row.locator(`[data-task-field="${field}"] input`);
  await input.click();
  await input.press('ControlOrMeta+a');
  await input.press('Backspace');
  await input.pressSequentially(value, { delay: 30 });
  await input.press('Tab');
}

export async function runNhr(entries: Entry[], ui: Ui) {
  for (const e of entries) if (!NHR_TYPE[e.remark]) throw new Error(`${e.date}: Remarks "${e.remark}" is not WFH or ONSITE`);
  const month = entries.map(e => e.date).sort()[0].slice(0, 7);
  if (entries.some(e => !e.date.startsWith(month))) throw new Error('NHR runs one month at a time');

  const isMonth = (method: string) => (r: { url(): string; request(): { method(): string } }) =>
    r.url().endsWith(`/timesheets/me/${month}`) && r.request().method() === method;

  // Reload and read the month the page itself fetches; its API needs the page's auth
  async function load(page: Page): Promise<Month> {
    const [res] = await Promise.all([page.waitForResponse(isMonth('GET')), page.reload()]);
    const { data } = (await res.json()) as { data: Month };
    if (data.period !== month) throw new Error(`NHR opened ${data.period}, CSV is ${month}`);
    return data;
  }
  const keys = (m: Month) => m.dailyLogs.flatMap(d => d.tasks.map(t => entryKey(d.date, t.taskName, t.hours)));

  const page = await openPage(siteUrl(loadConfig(), 'nhrUrl', 'NHR timesheet'), `show ${month}`, ui);
  try {
    const site = await load(page);
    const todo = missing(entries, keys(site));
    ui.log(`${entries.length - todo.length} already on NHR, ${todo.length} to add.`);

    const siteHours = site.dailyLogs.flatMap(d => d.tasks.map(t => ({ date: d.date, hours: t.hours })));
    if (todo.length && (await ui.ask(...confirmAdd('NHR', todo, overDays(siteHours, todo))))) {
      for (const [date, list] of Map.groupBy(todo, e => e.date)) {
        const existing = site.dailyLogs.find(d => d.date === date)?.tasks ?? [];
        let cursor = Math.max(toMin(DAY_START), ...existing.map(t => toMin(t.endTime)));
        const add = await showDay(page, date);
        const card = page.locator(`[data-day-card-date="${date}"]`);
        const rows = card.locator('app-task-row');
        // the card renders before its saved rows do
        await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length === n,
          [`[data-day-card-date="${date}"] app-task-row`, existing.length] as const);
        for (const e of list) {
          const [start, end] = period(cursor, e.hours);
          cursor = end;
          const count = await rows.count();
          await add.click();
          const row = rows.nth(count); // a new row stays last until it is confirmed
          await row.waitFor();
          // NHR focuses Project a moment after the click; typing earlier sends keys to the wrong field
          await page.waitForFunction(() => document.activeElement?.getAttribute('data-task-field') === 'project');
          await row.locator('[data-task-field="project"]').fill(e.projectName);
          await row.locator('[data-task-field="task"]').fill(e.task);
          // Start must stay before End, so move whichever side keeps that true first
          const shownStart = toMin((await row.locator('[data-task-field="periodStart"] input').inputValue()) || '00:00');
          if (end > shownStart) { await setTime(row, 'periodEnd', toTime(end)); await setTime(row, 'periodStart', toTime(start)); }
          else { await setTime(row, 'periodStart', toTime(start)); await setTime(row, 'periodEnd', toTime(end)); }
          // NHR may flip Category to OT while times are typed, so set it after them
          await row.locator('[data-label="Category"] select').selectOption('Working');
          await row.locator('[data-label="Type"] select').selectOption(NHR_TYPE[e.remark]);
          const shown = parseFloat(await row.locator('[data-label="Work Hours"]').innerText());
          if (shown !== e.hours) throw new Error(`${date} ${e.task}: NHR shows ${shown}h for ${toTime(start)}-${toTime(end)}, CSV says ${e.hours}h`);
          // Enter confirms the row; NHR keeps it open if anything is invalid
          await row.locator('[data-task-field="project"]').press('Enter');
          await card.locator('[data-task-field="project"]').waitFor({ state: 'detached', timeout: 5000 }).catch(async () => {
            const msg = await card.locator('.text-red-500').allInnerTexts();
            throw new Error(`${date} ${e.task}: NHR did not accept the row. ${msg.join(' ').trim()}`);
          });
          ui.log(`row   ${date}  ${toTime(start)}-${toTime(end)}  ${e.task}`);
        }
        const [res] = await Promise.all([
          page.waitForResponse(isMonth('PUT')),
          page.getByRole('button', { name: 'Save', exact: true }).click(),
        ]);
        if (!res.ok()) throw new Error(`Save ${date} failed: ${res.status()} ${await res.text()}`);
        ui.log(`saved ${date}`);
      }
      const still = missing(entries, keys(await load(page)));
      ui.log(still.length ? `Still missing ${still.length}:\n${still.map(entryLine).join('\n')}` : 'All entries are on NHR.');
    }
    await ui.ask('Check the page. Submit yourself when ready.', 'done');
  } catch (err) {
    ui.log('Unsaved rows on the current day were not saved.');
    await screenshotOnError(page, err);
  } finally {
    await page.context().close();
  }
}

if (import.meta.main) {
  const { entries, dryRun } = entriesFromArgs();
  printByDay(entries);
  if (!dryRun) await runNhr(entries, cliUi);
}
