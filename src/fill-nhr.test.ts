import { test } from 'node:test';
import assert from 'node:assert/strict';
import { period } from './fill-nhr.ts';

const h = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

test('periods skip the 12:00-13:00 lunch hour', () => {
  assert.deepEqual(period(h('08:30'), 3.5), [h('08:30'), h('12:00')]);
  assert.deepEqual(period(h('11:30'), 3.5), [h('11:30'), h('16:00')]);
  assert.deepEqual(period(h('12:00'), 1), [h('13:00'), h('14:00')]);
  assert.deepEqual(period(h('13:30'), 0.5), [h('13:30'), h('14:00')]);
});
