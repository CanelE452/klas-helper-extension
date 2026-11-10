const assert = require('node:assert/strict');
const test = require('node:test');
const { parseDeadline, normalizeCourses, normalizeLessons } = require('../src/monitor/model.cjs');

const course = { key: '2026,2::C1', name: 'Synthetic course', term: '2026,2' };
const observedAt = '2026-11-10T03:00:00.000Z';

test('KST minute deadlines include the entire final minute regardless of host timezone', () => {
  assert.equal(parseDeadline('2026-11-10 12:00'), '2026-11-10T03:00:59.999Z');
  assert.equal(parseDeadline('2026-11-10 12:00:30'), '2026-11-10T03:00:30.000Z');
  assert.equal(parseDeadline('2026-11-10T12:00:30+09:00'), '2026-11-10T03:00:30.000Z');
  assert.equal(parseDeadline('2026-11-10T03:00:30.123Z'), '2026-11-10T03:00:30.123Z');
});

test('impossible and missing dates are unknown rather than rolled into another day', () => {
  for (const date of [null, '', {}, '2026-02-30 12:00', '2026-13-01 12:00', '2026-11-10 24:00', 'tomorrow', '2026-11-10']) {
    assert.equal(parseDeadline(date), null);
  }
  assert.equal(parseDeadline('2024-02-29 12:00'), '2024-02-29T03:00:59.999Z');
});

test('course identity includes term and deduplicates duplicate selectors only', () => {
  const { courses, issues } = normalizeCourses([
    { subj: 'C1', subjNm: 'Synthetic course', yearhakgi: '2026,2', studentNo: 'DO-NOT-EXPORT' },
    { subj: 'C1', subjNm: 'Synthetic course', yearhakgi: '2026,2' },
    { subj: 'C1', subjNm: 'Other term', yearhakgi: '2026,1' },
    null,
  ]);
  assert.equal(courses.length, 2);
  assert.notEqual(courses[0].key, courses[1].key);
  assert.deepEqual(Object.keys(courses[0]).sort(), ['key', 'name', 'term']);
  assert.ok(issues.some(({ code }) => code === 'invalid-course'));
  assert.ok(!JSON.stringify({ courses, issues }).includes('DO-NOT-EXPORT'));
});

test('unfinished public lessons include overdue rows and string progress is normalized', () => {
  const rows = [
    { evltnSe: 'lesson', prog: 0, endDate: '2026-11-10 11:59', sbjt: 'Overdue', password: 'SECRET' },
    { evltnSe: 'lesson', prog: '50', endDate: '2026-11-10 12:00', sdesc: 'Open' },
    { evltnSe: 'lesson', prog: 100 },
    { evltnSe: 'lesson', prog: '100' },
    { evltnSe: 'lesson', prog: 0, isonoff: 'OFF' },
    { evltnSe: 'quiz', prog: 0 },
  ];
  const result = normalizeLessons(course, rows, observedAt);
  assert.equal(result.lessons.length, 2);
  assert.equal(result.lessons[0].deadlineState, 'overdue');
  assert.equal(result.lessons[1].deadlineState, 'open');
  assert.equal(result.lessons[1].progress, 50);
  assert.equal(result.lessons[0].observedAt, observedAt);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.deepEqual(Object.keys(result.lessons[0]).sort(), ['key', 'courseKey', 'courseName', 'term', 'title', 'progress', 'deadline', 'deadlineState', 'observedAt'].sort());
});

test('deadline remains open at its exact final millisecond and closes immediately after', () => {
  const rows = [{ evltnSe: 'lesson', prog: 0, endDate: '2026-11-10 12:00' }];
  assert.equal(normalizeLessons(course, rows, '2026-11-10T03:00:59.998Z').lessons[0].deadlineState, 'open');
  assert.equal(normalizeLessons(course, rows, '2026-11-10T03:00:59.999Z').lessons[0].deadlineState, 'open');
  assert.equal(normalizeLessons(course, rows, '2026-11-10T03:01:00.000Z').lessons[0].deadlineState, 'overdue');
});

test('invalid progress and dates remain visibly unknown, with safe issue codes', () => {
  const rows = [null, ...[null, '', 'bad', -1, 101, false, NaN].map((prog) => ({ evltnSe: 'lesson', prog, expireDate: 'bad' }))];
  const { lessons, issues } = normalizeLessons(course, rows, observedAt);
  assert.equal(lessons.length, 7);
  assert.ok(lessons.every((lesson) => lesson.progress === null && lesson.deadline === null && lesson.deadlineState === 'unknown'));
  assert.ok(issues.some(({ code }) => code === 'invalid-row'));
  assert.ok(issues.some(({ code }) => code === 'invalid-progress'));
  assert.ok(issues.some(({ code }) => code === 'invalid-deadline'));
  assert.ok(issues.every((issue) => Object.keys(issue).every((key) => ['code', 'courseKey'].includes(key))));
});

test('title and deadline aliases work and identical titles are kept as separate lessons', () => {
  const row = { evltnSe: 'lesson', prog: '0', title: '<img src=x onerror=alert(1)>', expiredate: '2026-11-10 13:00' };
  const { lessons } = normalizeLessons(course, [row, { ...row }, { evltnSe: 'lesson', prog: 1 }], observedAt);
  assert.equal(lessons.length, 3);
  assert.notEqual(lessons[0].key, lessons[1].key);
  assert.equal(lessons[0].title, row.title);
  assert.match(lessons[2].title, /3/);
});

test('nondecimal progress does not silently become a completed lesson', () => {
  const { lessons } = normalizeLessons(course, [{ evltnSe: 'lesson', prog: '0x64', endDate: '2026-11-10 13:00' }], observedAt);
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].progress, null);
});

test('encoded selector keys remain bounded for downstream snapshot validation', () => {
  const { courses, issues } = normalizeCourses([{ subj: '가'.repeat(80), subjNm: 'Synthetic course', yearhakgi: '2026,2' }]);
  assert.equal(courses.length, 0);
  assert.ok(issues.some(({ code }) => code === 'invalid-course'));
});

test('objects without a lesson type are data issues rather than a successful empty list', () => {
  const { lessons, issues } = normalizeLessons(course, [{ arbitraryPrivateField: 'DO-NOT-EXPORT' }], observedAt);
  assert.equal(lessons.length, 0);
  assert.deepEqual(issues, [{ code: 'invalid-row', courseKey: course.key }]);
});

test('course selectors reject control characters and unpaired surrogates without throwing', () => {
  for (const value of ['2026,\u00002', '2026,\u007f2', '\ud800', '\udc00']) {
    for (const field of ['yearhakgi', 'subj']) {
      const result = normalizeCourses([{ subj: 'C1', subjNm: 'Synthetic course', yearhakgi: '2026,2', [field]: value }]);
      assert.deepEqual(result, { courses: [], issues: [{ code: 'invalid-course' }] });
    }
  }
});
