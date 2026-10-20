import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './draft-report.ts';

const month = (...tasks: string[]) =>
  tasks.map(task => ({ task, date: '2026-10-01', hours: 1, projectId: '', projectName: '', remark: '' }));

test('summary lines follow the kinds of work in the month', () => {
  const { keyHighlights, upcomingFocus } = summarize(month(
    'TICKET-1 [FE] Move the modal table to a data grid',
    'TICKET-2 [BE] Fix total and sort of the strategy list',
    '[Team] Daily Stand up Meeting',
    'Create release document',
  ));
  assert.equal(keyHighlights.length, 6);
  assert.equal(upcomingFocus.length, 3);
  assert.ok(keyHighlights.every(line => !/TICKET|\[FE\]|\[BE\]/.test(line)));
});

test('a meetings-only month gets only the matching lines', () => {
  const { keyHighlights, upcomingFocus } = summarize(month('[Team] Sprint Planning'));
  assert.deepEqual(keyHighlights, ['Contributed to team planning, task estimation and progress reviews.']);
  assert.equal(upcomingFocus.length, 2);
});

test('a testing month gets testing lines, not developer lines', () => {
  const { keyHighlights, upcomingFocus } = summarize(month(
    'TICKET-3 [QA] Create test cases for the strategy list',
    'Regression test before release',
    'Verify bug fixes on the risk page',
  ));
  assert.ok(keyHighlights.some(line => line.startsWith('Tested application features')));
  assert.ok(!keyHighlights.some(line => line.startsWith('Developed') || line.startsWith('Fixed') || line.startsWith('Improved page')));
  assert.ok(upcomingFocus.some(line => line.startsWith('Continue testing')));
});
