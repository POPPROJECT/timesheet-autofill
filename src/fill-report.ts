// npm run report -- reports/YYYY-MM.json
// Fills the form and stops; you review and press Submit Report yourself.
import { readFileSync } from 'node:fs';
import { cliUi, loadConfig, openPage, screenshotOnError, siteUrl, type Ui } from './browser.ts';
import type { Report } from './draft-report.ts';

// report key -> category key used in the page's element ids
export const CATEGORIES: [keyof Report, string][] = [
  ['keyHighlights', 'keyHighlight'],
  ['upcomingFocus', 'upcomingFocus'],
  ['issues', 'issue'],
  ['concerns', 'concern'],
  ['risks', 'risk'],
  ['needSupport', 'needSupport'],
];

export async function runReport(report: Report, ui: Ui) {
  if (!report.projectName) throw new Error('Project name is empty');
  const config = loadConfig();
  if (!config.reporterName) throw new Error('Set your name in Settings first');

  const page = await openPage(siteUrl(config, 'reportUrl', 'Monthly Report'), 'make sure the form is empty', ui);
  try {
    await page.locator('#nameInput').fill(config.reporterName);
    // Role is optional: left blank, the user picks it on the site before submitting
    if (config.reporterRole) await page.locator('#roleInput').selectOption(config.reporterRole);
    else ui.log('Role left empty: choose it on the report page before you submit.');
    await page.locator('#projectSearch_1').fill(report.projectName);
    await page.locator('#projectList_1 .dropdown-option')
      .filter({ hasText: new RegExp(`^${RegExp.escape(report.projectName)}$`) })
      .click();

    for (const [key, cat] of CATEGORIES) {
      const items = page.locator(`#list_1_${cat} .list-item`);
      for (const text of report[key] as string[]) {
        const before = await items.count();
        await page.locator(`#catSection_1_${cat} .btn-add-center`).click();
        const box = page.locator(`#input_1_${cat}`);
        await box.fill(text);
        await box.blur(); // the page commits the item on blur
        await items.nth(before).waitFor();
      }
      ui.log(`${key}: ${(report[key] as string[]).length} item(s)`);
    }
    await ui.ask('Filled. Review and press Submit Report in the browser yourself.', 'done');
  } catch (err) {
    await screenshotOnError(page, err);
  } finally {
    await page.context().close();
  }
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: npm run report -- reports/YYYY-MM.json');
  await runReport(JSON.parse(readFileSync(path, 'utf8')), cliUi);
}
