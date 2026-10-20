import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, overDays, parseCsv, toEntries } from './csv.ts';

const sample = [
  'Vendor,Contract No.',
  'Date (MMDDYYYY),Project ID,Project Name,Vendor,Resources,Role,Level,Activity / Task Description,Hours, Remarks (Optional) ,,Chcek',
  '10/14/2026,P-001,Demo Project,Extosoft,X,FE,Mid,"TICKET-1 [BE] Fix total, sort",3.50,ONSITE,,Pass',
  '10/14/2026,P-001,Demo Project,Extosoft,X,FE,Mid,Version\x92s philosophy,0.50,WFH,,Pass',
  '10/16/2026,P-001,Demo Project,Extosoft,X,FE,Mid,,,WFH,,Pass',
  'Total Billing Hours (Days),,,,,,,,94.00',
].join('\r\n');

test('reads timesheet rows, skips blanks and footer', () => {
  const bytes = Uint8Array.from(sample, ch => ch.charCodeAt(0));
  const entries = toEntries(parseCsv(decode(bytes)));
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    date: '2026-10-14', projectId: 'P-001', projectName: 'Demo Project',
    task: 'TICKET-1 [BE] Fix total, sort', hours: 3.5, remark: 'ONSITE', resource: 'X',
  });
  assert.equal(entries[1].task, 'Version’s philosophy');
});

test('flags days that pass 8h with the new rows', () => {
  const row = (date: string, hours: number) => ({ date, hours, task: 't', projectId: '', projectName: '', remark: '' });
  const site = [{ date: '2026-10-14', hours: 7.5 }, { date: '2026-10-15', hours: 4 }];
  assert.deepEqual(overDays(site, [row('2026-10-14', 1), row('2026-10-15', 4), row('2026-10-16', 9)]), [
    '2026-10-14: 7.5h already there + 1h new = 8.5h',
    '2026-10-16: 0h already there + 9h new = 9h',
  ]);
});
