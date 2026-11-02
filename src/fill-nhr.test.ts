import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraRows, freePeriod, nhrHours, period, roundUpTenth } from './fill-nhr.ts';

const h = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

test('periods skip the 12:00-13:00 lunch hour', () => {
  assert.deepEqual(period(h('08:30'), 3.5), [h('08:30'), h('12:00')]);
  assert.deepEqual(period(h('11:30'), 3.5), [h('11:30'), h('16:00')]);
  assert.deepEqual(period(h('12:00'), 1), [h('13:00'), h('14:00')]);
  assert.deepEqual(period(h('13:30'), 0.5), [h('13:30'), h('14:00')]);
});

const row = (date: string, hours: number) => ({ date, hours, task: 't', projectId: '', projectName: '', remark: '', resource: '' });

test('hours round up to 0.1, and a full day stays at 8h', () => {
  assert.equal(roundUpTenth(0.75), 0.8);
  assert.equal(roundUpTenth(0.5), 0.5);
  assert.equal(roundUpTenth(0.3), 0.3);

  const [a, b, c] = [row('d', 0.75), row('d', 0.25), row('d', 7)];
  const full = nhrHours([a, b, c]);
  assert.deepEqual([full.get(a), full.get(b), full.get(c)], [0.8, 0.3, 6.9]);

  const short = row('e', 0.75);
  assert.equal(nhrHours([short]).get(short), 0.8);
  const over = row('f', 9.25);
  assert.equal(nhrHours([over]).get(over), 9.3);
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
    { taskName: 'Rounded', hours: 0.75, category: 'Working' },
    { taskName: 'Annual Leave', hours: 8, category: 'Leave' },
    { taskName: 'Weekend deploy', hours: 3, category: 'OT' },
  ];
  const csv = [{ task: 'Stand up', hours: 0.5 }, { task: 'Same task other hours', hours: 2 }, { task: 'Rounded', hours: 0.8 }];
  assert.deepEqual(extraRows(site, csv).map(t => t.taskName), ['Typed by hand', 'Same task other hours']);
});
