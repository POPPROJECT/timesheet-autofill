// npm run nhr -- <timesheet.csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]
// Makes the selected days on the Extosoft NHR timesheet match the CSV: adds missing rows and, after you
// confirm, removes Working rows the CSV does not have. Saves the draft after each day.
// Never presses Submit.
import type { Locator, Page } from 'playwright';
import { cliUi, confirmAdd, entryLine, loadConfig, openPage, screenshotOnError, siteUrl, type Ui } from './browser.ts';
import { entriesFromArgs, entryKey, missing, overDays, printByDay, type Entry } from './csv.ts';

// CSV Remarks column -> NHR Type
export const NHR_TYPE: Record<string, string> = { WFH: 'WFH', ONSITE: 'Onsite' };
const DAY_START = '08:00';
const LUNCH = [12 * 60, 13 * 60]; // NHR leaves this hour out of Work Hours

type Task = { taskName: string; startTime: string; endTime: string; hours: number; category?: string };
type Month = { period: string; dailyLogs: { date: string; tasks: Task[] }[] };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function period(start: number, hours: number): [number, number] {
  if (start >= LUNCH[0] && start < LUNCH[1]) start = LUNCH[1];
  let end = start + Math.round(hours * 60);
  if (start < LUNCH[0] && end > LUNCH[0]) end += LUNCH[1] - LUNCH[0];
  return [start, end];
}

// First period from `start` that does not overlap a row already on the day
export function freePeriod(start: number, hours: number, busy: [number, number][]): [number, number] {
  for (;;) {
    const [from, to] = period(start, hours);
    const clash = busy.find(([a, b]) => from < b && to > a);
    if (!clash) return [from, to];
    start = clash[1];
  }
}

// Working rows on the site that no CSV row accounts for; Leave, OT and Non-billing rows are never touched
export function extraRows<T extends { taskName: string; hours: number; category?: string }>(tasks: T[], csv: { task: string; hours: number }[]): T[] {
  const left = csv.map(e => `${e.task.trim()}|${e.hours}`);
  return tasks.filter(t => {
    if (t.category !== 'Working') return false;
    const i = left.indexOf(`${t.taskName.trim()}|${t.hours}`);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
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

// A saved row's trash button, then NHR's own confirmation
async function removeRow(page: Page, rows: Locator, task: Task) {
  const before = await rows.count();
  const row = rows.filter({ hasText: task.taskName.trim() }).filter({ hasText: `${task.startTime}-${task.endTime}` }).first();
  await row.locator('.task-row__delete-button').click();
  await page.getByRole('button', { name: /^(delete|confirm|yes)\b/i }).first().click({ timeout: 5000 });
  await rows.nth(before - 1).waitFor({ state: 'detached' });
}

// all: every row of the CSV, including ones unticked in the page, so an unticked row on the site is not treated as extra
export async function runNhr(entries: Entry[], ui: Ui, csv: Entry[] = entries) {
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
  const dates = new Set(entries.map(e => e.date));
  const extrasOn = (m: Month, date: string) =>
    extraRows(m.dailyLogs.find(d => d.date === date)?.tasks ?? [], csv.filter(e => e.date === date));

  const page = await openPage(siteUrl(loadConfig(), 'nhrUrl', 'NHR timesheet'), `show ${month}`, ui);
  try {
    const site = await load(page);
    const todo = missing(entries, keys(site));
    const extras = [...dates].flatMap(date => extrasOn(site, date).map(t => ({ date, task: t.taskName, hours: t.hours })));
    ui.log(`${entries.length - todo.length} already on NHR, ${todo.length} to add, ${extras.length} to remove.`);

    const keptHours = site.dailyLogs.flatMap(d => {
      const gone = dates.has(d.date) ? extrasOn(site, d.date) : [];
      return d.tasks.filter(t => !gone.includes(t)).map(t => ({ date: d.date, hours: t.hours }));
    });
    if ((todo.length || extras.length) && (await ui.ask(...confirmAdd('NHR', todo, overDays(keptHours, todo), extras)))) {
      const byDay = Map.groupBy(todo, e => e.date);
      for (const date of new Set([...byDay.keys(), ...extras.map(x => x.date)])) {
        const list = byDay.get(date) ?? [];
        const existing = site.dailyLogs.find(d => d.date === date)?.tasks ?? [];
        const gone = extrasOn(site, date);
        const add = await showDay(page, date);
        const card = page.locator(`[data-day-card-date="${date}"]`);
        const rows = card.locator('app-task-row');
        // the card renders before its saved rows do
        await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length === n,
          [`[data-day-card-date="${date}"] app-task-row`, existing.length] as const);
        for (const t of gone) {
          await removeRow(page, rows, t);
          ui.log(`removed ${date}  ${t.startTime}-${t.endTime}  ${t.taskName}`);
        }
        const busy = existing.filter(t => !gone.includes(t) && t.startTime && t.endTime)
          .map((t): [number, number] => [toMin(t.startTime), toMin(t.endTime)]);
        for (const e of list) {
          const [start, end] = freePeriod(toMin(DAY_START), e.hours, busy);
          busy.push([start, end]);
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
          // NHR shows one decimal (2.75 as 2.8) but keeps the period's exact minutes
          if (Math.abs(shown - e.hours) > 0.051) throw new Error(`${date} ${e.task}: NHR shows ${shown}h for ${toTime(start)}-${toTime(end)}, expected ${e.hours}h`);
          // Enter confirms the row; NHR keeps it open if anything is invalid
          await row.locator('[data-task-field="project"]').press('Enter');
          await card.locator('[data-task-field="project"]').waitFor({ state: 'detached', timeout: 5000 }).catch(async () => {
            const msg = await card.locator('.text-red-500').allInnerTexts();
            throw new Error(`${date} ${e.task}: NHR did not accept the row. ${msg.join(' ').trim()}`);
          });
          ui.log(`row   ${date}  ${toTime(start)}-${toTime(end)}  ${e.task}`);
        }
        // A day with only removals may have nothing left to save
        const save = page.getByRole('button', { name: 'Save', exact: true });
        if (await save.isEnabled()) {
          const [res] = await Promise.all([page.waitForResponse(isMonth('PUT')), save.click()]);
          if (!res.ok()) throw new Error(`Save ${date} failed: ${res.status()} ${await res.text()}`);
        }
        ui.log(`saved ${date}`);
      }
      const after = await load(page);
      const still = missing(entries, keys(after));
      ui.log(still.length ? `Still missing ${still.length}:\n${still.map(entryLine).join('\n')}` : 'All entries are on NHR.');
      const left = [...dates].flatMap(date => extrasOn(after, date).map(t => `${date}  ${t.hours}h  ${t.taskName}`));
      if (left.length) ui.log(`Still on NHR but not in the CSV:\n${left.join('\n')}`);
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
