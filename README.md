# Timesheet Autofill

Fills the ODC (PTTEP) and NHR (Extosoft) timesheets and the EP Monthly Report from the SharePoint timesheet CSV.
Runs on your own machine: Chrome opens and you sign in yourself. Nothing is ever Submitted for you.

## Setup (once)

Needs Node 24+ and Google Chrome.

```bash
npm install
npm start
```

Open http://localhost:3000. Under **Settings**, enter your name and the three site URLs, then press Save.
The URLs are not in this repo; get them from the team. Role is optional: leave it empty to pick it on the report page.
Settings are saved to `config.json`, which stays on your machine (git-ignored).

## Each month

1. In SharePoint, download the timesheet as **CSV** and drop it on the page. Untick rows you don't want sent (holidays, placeholders).
2. **Fill ODC** with the PTTEP VPN on, then **Fill NHR** with the Extosoft VPN on.
   The first run asks you to sign in. The `.browser-profile` folder keeps the sign-in after that.
   Each run skips rows already on the site and asks before adding.
3. Have an AI agent write the Monthly Report: open this folder in Claude Code and run `/monthly-report <file.csv>`, or ask any agent to follow `AGENTS.md`.
   Then in the **Monthly Report** tab press **Load saved**, review, **Fill report form**, and press Submit Report on the site yourself.
   You can also type the items into the boxes yourself and press Save.

To adapt to a site change, see `AGENTS.md`.

The CSV must use the SharePoint template columns: `Date (MMDDYYYY)`, `Project ID`, `Project Name`, `Activity / Task Description`, `Hours`, `Remarks` (`WFH` / `ONSITE`).

If a run stops, `error.png` shows the page at that moment.

## Command line

`npm run timesheet|nhr -- <file.csv> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]`, `npm run report -- reports/YYYY-MM.json`, `npm test`.
