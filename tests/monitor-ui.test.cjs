const assert = require('node:assert/strict');
const test = require('node:test');
const { createMonitorController } = require('../src/monitor/ui.cjs');

const subject = { subj: 'DEMO101', subjNm: 'Synthetic course', yearhakgi: '2026,2' };
const result = (status = 'complete') => ({
  schemaVersion: 1,
  attemptedAt: '2026-11-10T00:00:00.000Z',
  capturedAt: status === 'error' ? null : '2026-11-10T00:00:00.000Z',
  status,
  courses: [],
  lessons: [],
  issues: [],
});

test('starts without exporting, then exports only an explicitly requested fresh observation', async () => {
  const downloads = [];
  const controller = createMonitorController({ getCourses: () => [subject], collect: async () => result(), download: (x) => downloads.push(x) });
  assert.equal(controller.getState().canExport, false);
  assert.equal(controller.exportSnapshot(), false);
  await controller.refresh();
  assert.equal(downloads.length, 0);
  assert.equal(controller.getState().canExport, true);
  assert.equal(controller.exportSnapshot(), true);
  assert.equal(downloads.length, 1);
});

test('retains last successful display and timestamp after offline refresh, disables export', async () => {
  let offline = false;
  const controller = createMonitorController({ getCourses: () => [subject], collect: async () => offline ? { ...result('error'), status: 'offline' } : result() });
  await controller.refresh();
  offline = true;
  await controller.refresh();
  const state = controller.getState();
  assert.equal(state.snapshot.capturedAt, '2026-11-10T00:00:00.000Z');
  assert.equal(state.lastAttempt.status, 'offline');
  assert.equal(state.stale, true);
  assert.equal(state.canExport, false);
});

test('prevents overlapping requests and discards results if the selected courses changed', async () => {
  let courses = [subject];
  let resolve;
  let calls = 0;
  const controller = createMonitorController({ getCourses: () => courses, collect: () => { calls++; return new Promise((r) => { resolve = r; }); } });
  const pending = controller.refresh();
  await controller.refresh();
  assert.equal(calls, 1);
  courses = [{ ...subject, yearhakgi: '2027,1' }];
  resolve(result());
  await pending;
  assert.equal(controller.getState().snapshot, null);
  assert.equal(controller.getState().canExport, false);
});

test('rechecks selection at export and never downloads another semester', async () => {
  let courses = [subject];
  let downloads = 0;
  const controller = createMonitorController({ getCourses: () => courses, collect: async () => result(), download: () => downloads++ });
  await controller.refresh();
  courses = [];
  assert.equal(controller.exportSnapshot(), false);
  assert.equal(downloads, 0);
  assert.equal(controller.getState().snapshot, null);
});

test('handles missing login/course context without making a network request', async () => {
  let calls = 0;
  const controller = createMonitorController({ getCourses: () => null, collect: async () => { calls++; return result(); } });
  await controller.refresh();
  assert.equal(calls, 0);
  assert.equal(controller.getState().messageCode, 'courses-unavailable');
});

test('does not report a still-empty loading course list as zero unfinished lessons', async () => {
  let calls = 0;
  const controller = createMonitorController({ getCourses: () => [], collect: async () => { calls++; return result(); } });
  await controller.refresh();
  assert.equal(calls, 0);
  assert.equal(controller.getState().canExport, false);
  assert.equal(controller.getState().messageCode, 'courses-unavailable');
});

test('does not export snapshots exceeding the local reader bounds', async () => {
  for (const lessons of [Array.from({ length: 10001 }, () => ({})), [{ title: 'x'.repeat(2 * 1024 * 1024) }]]) {
    const controller = createMonitorController({ getCourses: () => [subject], collect: async () => ({ ...result(), lessons }) });
    await controller.refresh();
    assert.equal(controller.getState().canExport, false);
    assert.equal(controller.getState().messageCode, 'snapshot-too-large');
    assert.equal(controller.exportSnapshot(), false);
  }
});

test('unexpected exceptions are replaced by a safe code without leaking their message', async () => {
  const controller = createMonitorController({ getCourses: () => [subject], collect: async () => { throw Error('SYNTHETIC_PASSWORD_DO_NOT_PRINT'); } });
  await controller.refresh();
  assert.equal(controller.getState().messageCode, 'error');
  assert.equal(JSON.stringify(controller.getState()).includes('SYNTHETIC_PASSWORD'), false);
});

test('partial observations are explicitly marked and exportable with their failure status', async () => {
  const controller = createMonitorController({ getCourses: () => [subject], collect: async () => result('partial') });
  await controller.refresh();
  assert.equal(controller.getState().messageCode, 'partial');
  assert.equal(controller.getState().canExport, true);
});
