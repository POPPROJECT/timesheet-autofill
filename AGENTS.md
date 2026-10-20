# AGENTS.md

Guide for AI coding agents (Claude Code, Codex, Cursor, …) working in this repo.

## What this is

A local tool that fills two company timesheets (ODC and NHR) and a Monthly Report form from a SharePoint timesheet CSV.
Playwright drives the user's own Chrome (`channel: 'chrome'`) with a persistent profile in `.browser-profile/`.
The user signs in, confirms each batch, and presses Submit on every site themselves.

- `npm start` runs `src/server.ts` and serves the page `public/index.html` at http://localhost:3000.
- CLI: `npm run timesheet|nhr -- <file.csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]`, `npm run draft -- <file.csv>`, `npm run report -- reports/YYYY-MM.json`.
- `npm test` runs `node --test` on `src/*.test.ts`.

| File | Role |
|---|---|
| `src/csv.ts` | Parses the CSV (Windows-1252), matches rows against what a site already has, over-8h check |
| `src/fill-timesheet.ts` | ODC filler |
| `src/fill-nhr.ts` | NHR filler (time periods, lunch hour, per-day save) |
| `src/fill-report.ts` | Monthly Report form filler |
| `src/draft-report.ts` | `Report` type and the rule-based summary (`HIGHLIGHT_RULES`, `FOCUS_RULES`) |
| `src/browser.ts` | Config, Chrome launch, the `Ui` interface shared by the CLI and the web page |
| `src/server.ts` | Local HTTP API and server-sent events for the page |

## Task: write the Monthly Report

Use this when the user asks for the monthly report, or runs `/monthly-report`.

1. Read the timesheet CSV the user names. If they named none, use the newest `*.csv` in `~/Downloads` and say which file you used.
   The file is Windows-1252, so read it through the project's parser:
   ```bash
   node --input-type=module -e "import { readEntries } from './src/csv.ts'; for (const e of readEntries(process.argv[1])) console.log(e.date, e.hours + 'h', e.remark, e.task)" <file.csv>
   ```
2. If you have an issue-tracker connection (for example Jira), you may look up the user's open tickets in the current sprint to ground Upcoming Focus. Do not invent work that appears in neither source.
3. Write `reports/YYYY-MM.json`, where YYYY-MM is the CSV's month. Overwrite it only if the user says so; otherwise ask first.
   ```json
   {
     "projectName": "<Project Name column from the CSV>",
     "keyHighlights": ["…"],
     "upcomingFocus": ["…"],
     "issues": [],
     "concerns": [],
     "risks": [],
     "needSupport": []
   }
   ```
4. Tell the user to refresh the **Monthly Report** tab, review the text, then press **Fill report form**.

Style, which the readers of this report expect:

- Key Highlights: about 5 items. Each is one past-tense sentence ("Developed…", "Improved…", "Fixed…", "Contributed to…").
- Upcoming Focus: about 3 items ("Continue…", "Support user acceptance testing…", "Work with the team to…").
- Write for non-technical readers. Describe what users got (features, screens, data, fixes, planning, documentation, releases).
- Never include ticket keys, `[FE]` / `[BE]`, hours, component or library names, API names, or people's names.
- Leave Issues, Concerns, Risks and Need Support empty unless the user gives content for them.

Example of the expected tone:

```json
"keyHighlights": [
  "Developed and updated web application features to support equipment management, investigation records, and risk information.",
  "Improved navigation menus, page layouts, and data tables to make information easier to access and review.",
  "Fixed issues affecting data entry and information display, and improved code quality to support ongoing maintenance.",
  "Contributed to team planning, task estimation, and progress reviews. Prepared supporting documentation and participated in system release activities."
],
"upcomingFocus": [
  "Continue developing and improving application features based on the team's planned work.",
  "Continue resolving application issues and improving usability and code quality.",
  "Work with the team to review upcoming requirements, refine task estimates, and plan development activities."
]
```

## Changing things

- **Generated wording**: edit `HIGHLIGHT_RULES` / `FOCUS_RULES` in `src/draft-report.ts`. A line is used when any task in the month matches its pattern. Run `npm test`.
- **A site changed and a run fails**: `error.png` shows the page at the failure. Inspect the live page with a throwaway Playwright script on the same `.browser-profile`, then press Cancel. Never press Save or Submit while probing. Prefer roles and labels over placeholders or CSS classes.
  - ODC: each day is `#tsday-YYYY-MM-DD`; form fields are found by their `.field-label`.
  - NHR: rows use `data-task-field` attributes. Read the comments in `src/fill-nhr.ts` before changing it: NHR moves focus after `+ Task`, switches Category to OT while times are typed, and re-renders when the page changes.
  - Monthly Report: element ids such as `#nameInput`, `#list_1_<category>`.
- **The page**: `public/index.html` is a single file with no build step. The server reads it on each request, so a browser refresh is enough. Changes under `src/` need `npm start` again.

## Rules

- The repo is public. Never commit `config.json`, `.browser-profile/`, `reports/`, CSV files or `error.png`. Never put site URLs, project codes, or people's names in tracked files. The site URLs live only in each user's `config.json`, entered through Settings.
- No script presses a site's final Submit. Keep it that way.
- Node 24 runs the `.ts` files directly (type stripping). Use no enums, no constructor parameter properties, and import with the `.ts` extension.
- Run `npm test` after changes.
