import { describe, expect, it } from 'vitest';
import { addEvery, everyText, schedule, spent, TEMPLATES, type Task } from './upkeep';

const task = (id: string, o: Partial<Task> = {}): Task => ({ id, name: id, area: null, every_n: 1, every_unit: 'months', last_done: null, vendor: null, notes: null, is_active: true, location_id: null, created_at: '2026-01-01', ...o });

describe('upkeep', () => {
  it('adds intervals, clamping month ends', () => {
    expect(addEvery('2026-01-31', 1, 'months')).toBe('2026-02-28');
    expect(addEvery('2028-02-29', 1, 'years')).toBe('2029-02-28');
    expect(addEvery('2026-11-11', 2, 'weeks')).toBe('2026-11-25');
    expect(addEvery('2026-11-11', 10, 'days')).toBe('2026-11-21');
    expect(addEvery('2026-11-30', 3, 'months')).toBe('2027-02-28');
  });
  it('labels', () => {
    expect([everyText({ every_n: 1, every_unit: 'years' }), everyText({ every_n: 3, every_unit: 'months' })]).toEqual(['Every year', 'Every 3 months']);
    expect(TEMPLATES).toHaveLength(10);
  });
  it('due dates from the log or the starting date; never done = due now; paused apart', () => {
    const s = schedule(
      [task('filter', { every_n: 3, last_done: '2026-07-01' }), task('pest'), task('fire', { every_unit: 'years', last_done: '2026-01-05' }), task('old', { is_active: false })],
      [{ id: 'l1', task_id: 'filter', done_on: '2026-08-20', cost_cents: 4500, note: null }, { id: 'l2', task_id: 'filter', done_on: '2025-12-01', cost_cents: 100, note: null }],
      '2026-11-11',
    );
    expect(s.active.map((t) => [t.id, t.lastDone, t.due, t.days, t.status])).toEqual([
      ['pest', null, '2026-11-11', 0, 'soon'], ['filter', '2026-08-20', '2026-11-20', 9, 'soon'], ['fire', '2026-01-05', '2027-01-05', 55, 'ok'],
    ]);
    expect(s.active[1].spentCents).toBe(4600);
    expect(s.paused.map((t) => t.id)).toEqual(['old']);
  });
  it('late', () => {
    expect(schedule([task('x', { last_done: '2026-09-01' })], [], '2026-11-11').active[0]).toMatchObject({ due: '2026-10-01', days: -41, status: 'late' });
  });
  it('spending', () => {
    expect(spent([{ id: 'a', task_id: 'x', done_on: '2026-11-02', cost_cents: 100, note: null }, { id: 'b', task_id: 'x', done_on: '2026-03-02', cost_cents: 50, note: null }, { id: 'c', task_id: 'x', done_on: '2025-11-02', cost_cents: 7, note: null }], '2026-11-11')).toEqual({ month: 100, year: 150 });
  });
});
