// The Monthly Report as saved on disk. An AI agent or the user writes it (see AGENTS.md).

export type Report = {
  projectName: string; // must match an option in the report site's project dropdown
  keyHighlights: string[];
  upcomingFocus: string[];
  issues: string[];
  concerns: string[];
  risks: string[];
  needSupport: string[];
};

export const MONTH = /^\d{4}-\d{2}$/;
export const reportFile = (month: string) => `reports/${month}.json`;

export const emptyReport = (projectName = ''): Report =>
  ({ projectName, keyHighlights: [], upcomingFocus: [], issues: [], concerns: [], risks: [], needSupport: [] });
