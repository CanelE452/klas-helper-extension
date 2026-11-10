const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const readerPath = path.resolve(__dirname, '../scripts/read-monitor.cjs');
const currentTime = new Date('2026-11-10T01:20:00.000Z');
const options = { now: () => currentTime };

function fixture() {
  return {
    schemaVersion: 1,
    attemptedAt: '2026-11-10T00:59:59.000Z',
    capturedAt: '2026-11-10T01:00:00.000Z',
    status: 'complete',
    courses: [{ key: '2026-2:demo', name: 'Demo course', term: '2026-2', status: 'complete' }],
    lessons: [{
      key: '2026-2:demo:0',
      courseKey: '2026-2:demo',
      courseName: 'Demo course',
      term: '2026-2',
      title: 'Synthetic lesson',
      progress: 35,
      deadline: '2026-11-10T01:10:00.000Z',
      deadlineState: 'open',
      observedAt: '2026-11-10T01:00:00.000Z',
    }],
    issues: [],
  };
}

function reader() { return require(readerPath); }

function tempFile(t, contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'klas-reader-test-'));
  const filename = path.join(directory, 'synthetic.json');
  fs.writeFileSync(filename, contents);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return filename;
}

test('reader command exists and can summarize a valid local snapshot', (t) => {
  assert.equal(fs.existsSync(readerPath), true, 'local snapshot reader must exist');
  const result = reader().readSnapshot(tempFile(t, JSON.stringify(fixture())), options);
  assert.equal(result.status, 'complete');
  assert.equal(result.stale, true);
  assert.equal(result.ageMinutes, 20);
  assert.equal(result.asOf, currentTime.toISOString());
  assert.deepEqual(result.counts, { open: 0, overdue: 1, unknown: 0 });
  assert.equal(result.lessons[0].observedAt, fixture().lessons[0].observedAt);
  assert.equal(result.lessons[0].deadlineState, 'overdue');
});

test('reader strips extra fields at every level without leaking credentials', () => {
  const snapshot = fixture();
  snapshot.password = 'synthetic-secret';
  snapshot.courses[0].studentId = 'synthetic-secret';
  snapshot.lessons[0].cookie = 'synthetic-secret';
  snapshot.issues.push({ code: 'invalid-progress', courseKey: snapshot.courses[0].key, raw: 'synthetic-secret' });
  const result = reader().summarizeSnapshot(snapshot, options);
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
  assert.deepEqual(result.issues, [{ code: 'invalid-progress', courseKey: snapshot.courses[0].key }]);
});

test('read-time classification keeps the final deadline millisecond open and unknown dates unknown', () => {
  const snapshot = fixture();
  snapshot.lessons[0].deadline = currentTime.toISOString();
  snapshot.lessons.push({ ...snapshot.lessons[0], key: 'other', deadline: null, deadlineState: 'unknown', progress: null });
  const result = reader().summarizeSnapshot(snapshot, { ...options, maxAgeMs: 30 * 60 * 1000 });
  assert.equal(result.stale, false);
  assert.deepEqual(result.counts, { open: 1, overdue: 0, unknown: 1 });
});

test('partial and all-failed snapshots cannot appear as a healthy zero count', () => {
  const snapshot = fixture();
  snapshot.status = 'partial';
  snapshot.courses.push({ key: 'failed', name: 'Unavailable course', term: '2026-2', status: 'error' });
  snapshot.issues.push({ code: 'request-failed', courseKey: 'failed' });
  const partial = reader().summarizeSnapshot(snapshot, options);
  assert.equal(partial.partial, true);
  assert.deepEqual(partial.counts, { open: 0, overdue: 1, unknown: 0 });
  for (const status of ['error', 'auth-required', 'offline']) {
    const failed = fixture();
    failed.status = status;
    failed.capturedAt = null;
    failed.lessons = [];
    failed.courses[0].status = status;
    const result = reader().summarizeSnapshot(failed, options);
    assert.equal(result.stale, true);
    assert.equal(result.counts, null);
    assert.equal(result.ageMinutes, null);
  }
});

test('rejects unsupported schema and malformed bounded scalar values', () => {
  const mutations = [
    (s) => { s.schemaVersion = 2; },
    (s) => { s.status = 'healthy'; },
    (s) => { s.lessons[0].progress = 101; },
    (s) => { s.lessons[0].progress = '35'; },
    (s) => { s.lessons[0].title = 'x'.repeat(1001); },
    (s) => { s.lessons[0].deadline = '2026-02-30T01:00:00.000Z'; },
    (s) => { s.lessons[0].deadline = '<html>secret</html>'; },
    (s) => { s.capturedAt = '2026-11-10T02:00:00.000Z'; },
    (s) => { s.lessons[0].observedAt = '2026-11-10T02:00:00.000Z'; },
    (s) => { s.attemptedAt = 'invalid'; },
    (s) => { s.capturedAt = null; },
    (s) => { s.lessons = {}; },
    (s) => { s.courses[0].name = {}; },
    (s) => { s.issues = [{ code: 'unsafe code with private data' }]; },
  ];
  for (const mutate of mutations) {
    const snapshot = fixture();
    mutate(snapshot);
    assert.throws(() => reader().summarizeSnapshot(snapshot, options), { code: 'invalid-schema' });
  }
});

test('rejects duplicate identities and inconsistent course relationships', () => {
  const mutations = [
    (s) => { s.courses.push({ ...s.courses[0] }); },
    (s) => { s.lessons.push({ ...s.lessons[0] }); },
    (s) => { s.lessons[0].courseKey = 'missing'; },
    (s) => { s.lessons[0].courseName = 'Different'; },
    (s) => { s.lessons[0].term = 'Different'; },
    (s) => { s.courses[0].status = 'error'; },
    (s) => { s.issues.push({ code: 'request-failed', courseKey: 'missing' }); },
    (s) => { s.status = 'error'; },
    (s) => { s.status = 'partial'; },
  ];
  for (const mutate of mutations) {
    const snapshot = fixture();
    mutate(snapshot);
    assert.throws(() => reader().summarizeSnapshot(snapshot, options), { code: 'invalid-schema' });
  }
});

test('reader rejects malformed JSON, HTML, oversized files, directories and missing paths', (t) => {
  assert.throws(() => reader().readSnapshot(tempFile(t, '{bad'), options), { code: 'invalid-json' });
  assert.throws(() => reader().readSnapshot(tempFile(t, '<html>secret</html>'), options), { code: 'invalid-json' });
  assert.throws(() => reader().readSnapshot(tempFile(t, 'x'.repeat(2 * 1024 * 1024 + 1)), options), { code: 'snapshot-too-large' });
  assert.throws(() => reader().readSnapshot(path.join(os.tmpdir(), 'missing-klas-snapshot-never-created.json'), options), { code: 'snapshot-unavailable' });
  assert.throws(() => reader().readSnapshot(os.tmpdir(), options), { code: 'snapshot-unavailable' });
});

test('CLI error output contains a safe error code and no file contents or path', (t) => {
  const filename = tempFile(t, 'synthetic-private-secret');
  const result = spawnSync(process.execPath, [readerPath, filename], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { error: 'invalid-json' });
  assert.equal(result.stderr.includes(filename), false);
  assert.equal(result.stderr.includes('synthetic-private-secret'), false);
});

test('CLI requires exactly one filename', () => {
  const result = spawnSync(process.execPath, [readerPath], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr), { error: 'usage' });
});
