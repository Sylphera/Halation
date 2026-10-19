import { expect, test } from 'bun:test';
import { buildTaskView, elapsedLabel } from './readable-sidebar';
const sessions = [
  { id: 'root', agent: 'orchestrator', title: 'Mission' },
  { id: 'a', parentID: 'root', agent: 'fixer', title: 'Validar aislamiento', model: { id: 'deepseek-flash' }, outcome: 'succeeded', time: { created: 1000, updated: 5000, idle: 5000 } },
  { id: 'b', parentID: 'root', agent: 'fixer', title: 'Corregir detector', time: { created: 2000, updated: 7000 } },
  { id: 'nested', parentID: 'a', agent: 'explorer', title: 'Revisar contrato', outcome: 'failed', time: { created: 3000, updated: 6000, idle: 6000 } },
  { id: 'other-root' }, { id: 'foreign', parentID: 'other-root', agent: 'fixer', title: 'Do not show' },
];
test('lists actual task titles and multiple instances, excluding other conversations', () => {
  const v = buildTaskView(sessions, 'root', id => id === 'a' || id === 'b', 10000);
  expect(v.active.map(x => x.title)).toEqual(['Corregir detector', 'Validar aislamiento']);
  expect(v.finished.map(x => x.id)).toEqual(['nested']);
  expect(v.active.filter(x => x.role === 'fixer').length).toBe(2);
});
test('native running overrides stale success and completed times freeze', () => {
  expect(buildTaskView(sessions, 'root', id => id === 'a', 10000).active.find(x => x.id === 'a')?.state).toBe('working');
  const v = buildTaskView(sessions, 'root', () => false, 10000);
  expect(v.finished.find(x => x.id === 'a')?.elapsed).toBe(4000);
  expect(v.active.find(x => x.id === 'b')?.state).toBe('waiting');
});
test('opening a child preserves its parent task group and return destination', () => {
  const v = buildTaskView(sessions, 'b', () => false, 10000);
  expect(v.rootID).toBe('root'); expect(v.finished.length).toBe(2);
});
test('does not manufacture workers from configured roles', () => {
  const v = buildTaskView([{ id: 'root' }], 'root', () => false, 10000);
  expect(v.active).toEqual([]); expect(v.finished).toEqual([]);
});
test('parent cycles are bounded and do not leak sessions', () => {
  const v = buildTaskView([{ id: 'a', parentID: 'b' }, { id: 'b', parentID: 'a' }], 'a', () => true, 1000);
  expect(v.rootID).toBe(''); expect(v.active).toEqual([]);
});
test('elapsed time is readable and nonnegative', () => {
  expect(elapsedLabel(-1)).toBe('0s'); expect(elapsedLabel(65000)).toBe('1m 5s'); expect(elapsedLabel(3665000)).toBe('1h 1m');
});
