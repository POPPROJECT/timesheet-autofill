import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraRows, freePeriod, period } from './fill-nhr.ts';

const h = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

test('periods skip the 12:00-13:00 lunch hour', () => {
  assert.deepEqual(period(h('08:30'), 3.5), [h('08:30'), h('12:00')]);
  assert.deepEqual(period(h('11:30'), 3.5), [h('11:30'), h('16:00')]);
  assert.deepEqual(period(h('12:00'), 1), [h('13:00'), h('14:00')]);
  assert.deepEqual(period(h('13:30'), 0.5), [h('13:30'), h('14:00')]);
});

test('quarter hours keep their exact minutes', () => {
  assert.deepEqual(period(h('08:30'), 2.75), [h('08:30'), h('11:15')]);
});

test('new rows avoid rows already on the day', () => {
  assert.deepEqual(freePeriod(h('08:00'), 1, [[h('08:00'), h('08:30')]]), [h('08:30'), h('09:30')]);
  assert.deepEqual(freePeriod(h('08:00'), 1, [[h('08:30'), h('09:00')]]), [h('09:00'), h('10:00')]);
  assert.deepEqual(freePeriod(h('08:00'), 1, []), [h('08:00'), h('09:00')]);
});

test('extra rows are Working rows the CSV does not have', () => {
  const site = [
    { taskName: 'Stand up', hours: 0.5, category: 'Working' },
    { taskName: 'Typed by hand', hours: 2, category: 'Working' },
    { taskName: 'Same task other hours', hours: 1, category: 'Working' },
    { taskName: 'Quarter hour', hours: 0.75, category: 'Working' },
    { taskName: 'Annual Leave', hours: 8, category: 'Leave' },
    { taskName: 'Weekend deploy', hours: 3, category: 'OT' },
  ];
  const csv = [{ task: 'Stand up', hours: 0.5 }, { task: 'Same task other hours', hours: 2 }, { task: 'Quarter hour', hours: 0.75 }];
  assert.deepEqual(extraRows(site, csv).map(t => t.taskName), ['Typed by hand', 'Same task other hours']);
});
