const assert = require('node:assert/strict');
const test = require('node:test');
const { collectSnapshot } = require('../src/monitor/collect.cjs');

const rawCourse = { subj: 'C1', subjNm: 'Synthetic course', yearhakgi: '2026,2', password: 'PRIVATE' };
const rawLesson = { evltnSe: 'lesson', sbjt: 'Synthetic lesson', prog: 10, endDate: '2026-11-10 11:59', studentNo: 'PRIVATE' };
const now = () => new Date('2026-11-10T03:00:00Z');
const response = (data, overrides = {}) => ({ ok: true, status: 200, redirected: false, type: 'basic', headers: { get: () => 'application/json' }, json: async () => data, ...overrides });

test('collector calls only the fixed read endpoint and exports a whitelist', async () => {
  const calls = [];
  const snapshot = await collectSnapshot([rawCourse, { ...rawCourse }], { now, fetchImpl: async (...args) => { calls.push(args); return response([rawLesson]); } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/std/lis/evltn/SelectOnlineCntntsStdList.do');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[0][1].redirect, 'manual');
  assert.deepEqual(JSON.parse(calls[0][1].body), { selectSubj: 'C1', selectYearhakgi: '2026,2', selectChangeYn: 'Y' });
  assert.equal(snapshot.status, 'complete');
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.capturedAt, now().toISOString());
  assert.equal(snapshot.lessons[0].deadlineState, 'overdue');
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
});

test('all failed requests cannot be represented as successful zero unfinished lessons', async () => {
  const snapshot = await collectSnapshot([rawCourse], { now, fetchImpl: async () => { throw new TypeError('SECRET URL OR COOKIE'); } });
  assert.equal(snapshot.status, 'offline');
  assert.equal(snapshot.capturedAt, null);
  assert.equal(snapshot.courses[0].status, 'offline');
  assert.equal(snapshot.lessons.length, 0);
  assert.ok(!JSON.stringify(snapshot).includes('SECRET'));
});

test('authentication expiry via HTTP, redirects or HTML gets an auth-required result', async () => {
  for (const result of [response([], { ok: false, status: 401 }), response([], { ok: false, status: 403 }), response([], { redirected: true }), response([], { type: 'opaqueredirect' }), response([], { headers: { get: () => 'text/html' } })]) {
    const snapshot = await collectSnapshot([rawCourse], { now, fetchImpl: async () => result });
    assert.equal(snapshot.status, 'auth-required');
    assert.equal(snapshot.capturedAt, null);
  }
});

test('non-array responses, HTTP failure and malformed JSON are data errors', async () => {
  for (const result of [response({ studentNo: 'PRIVATE' }), response([], { ok: false, status: 500 }), response([], { json: async () => { throw new Error('PRIVATE'); } })]) {
    const snapshot = await collectSnapshot([rawCourse], { now, fetchImpl: async () => result });
    assert.equal(snapshot.status, 'error');
    assert.equal(snapshot.capturedAt, null);
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  }
});

test('partial results retain a failure per course and successful observation times', async () => {
  const snapshot = await collectSnapshot([rawCourse, { ...rawCourse, subj: 'C2' }], { now, fetchImpl: async (_, init) => JSON.parse(init.body).selectSubj === 'C1' ? response([rawLesson]) : response([], { ok: false, status: 401 }) });
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.capturedAt, now().toISOString());
  assert.deepEqual(snapshot.courses.map(({ status }) => status), ['complete', 'auth-required']);
  assert.equal(snapshot.lessons.length, 1);
});

test('invalid course sets and excessive data are bounded without leaking raw data', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response([]); };
  for (const raw of [null, {}, [null], Array.from({ length: 101 }, (_, n) => ({ ...rawCourse, subj: `C${n}` }))]) {
    const snapshot = await collectSnapshot(raw, { now, fetchImpl });
    assert.equal(snapshot.status, 'error');
    assert.equal(snapshot.capturedAt, null);
  }
  assert.equal(calls, 0);
  const excessive = await collectSnapshot([rawCourse], { now, fetchImpl: async () => response(Array(10001).fill(rawLesson)) });
  assert.equal(excessive.status, 'error');
});

test('timeouts finish even if the fetch implementation ignores abort', async () => {
  const start = Date.now();
  const snapshot = await collectSnapshot([rawCourse], { now, timeoutMs: 15, fetchImpl: () => new Promise(() => {}) });
  assert.equal(snapshot.status, 'error');
  assert.ok(snapshot.issues.some(({ code }) => code === 'timeout'));
  assert.ok(Date.now() - start < 1000);
});

test('bounded concurrency and row issues result in an explicitly partial snapshot', async () => {
  let active = 0;
  let peak = 0;
  const snapshot = await collectSnapshot(Array.from({ length: 7 }, (_, n) => ({ ...rawCourse, subj: `C${n}` })), {
    now,
    concurrency: 2,
    fetchImpl: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return response([{ ...rawLesson, prog: null }]);
    },
  });
  assert.equal(peak, 2);
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.lessons.length, 7);
});

test('empty enrolled-course list is a successful empty result without requests', async () => {
  const snapshot = await collectSnapshot([], { now, fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal(snapshot.status, 'complete');
  assert.deepEqual(snapshot.lessons, []);
  assert.equal(snapshot.capturedAt, now().toISOString());
});

test('total lesson cap excludes entire excess courses and preserves explicit partial status', async () => {
  const snapshot = await collectSnapshot([rawCourse, { ...rawCourse, subj: 'C2' }], {
    now,
    fetchImpl: async () => response(Array(6000).fill(rawLesson)),
  });
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.lessons.length, 6000);
  assert.deepEqual(snapshot.courses.map(({ status }) => status), ['complete', 'error']);
  assert.ok(snapshot.issues.some(({ code, courseKey }) => code === 'snapshot-too-large' && courseKey === snapshot.courses[1].key));
});

test('invalid selector characters produce a safe error before any request', async () => {
  let calls = 0;
  for (const value of ['2026,\u00002', '2026,\u007f2', '\ud800', '\udc00']) {
    const snapshot = await collectSnapshot([{ ...rawCourse, yearhakgi: value }], {
      now,
      fetchImpl: async () => { calls++; return response([]); },
    });
    assert.equal(snapshot.status, 'error');
    assert.equal(snapshot.capturedAt, null);
    assert.deepEqual(snapshot.issues, [{ code: 'invalid-course' }]);
  }
  assert.equal(calls, 0);
});
