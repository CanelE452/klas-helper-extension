'use strict';

const fs = require('node:fs');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_COURSES = 100;
const MAX_LESSONS = 10000;
const MAX_CLOCK_SKEW_MS = 60000;
const SNAPSHOT_STATUSES = new Set(['complete', 'partial', 'error', 'auth-required', 'offline']);
const COURSE_STATUSES = new Set(['complete', 'error', 'auth-required', 'offline']);
const SAFE_ERRORS = new Set(['invalid-schema', 'invalid-json', 'snapshot-too-large', 'snapshot-unavailable', 'usage']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-schema');
  return value;
}

function text(value, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    fail('invalid-schema');
  }
  return value;
}

function timestamp(value, latest = Infinity) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)) fail('invalid-schema');
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value || milliseconds > latest) {
    fail('invalid-schema');
  }
  return value;
}

function list(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) fail('invalid-schema');
  return value;
}

/** Validate and reconstruct only the published snapshot fields. No raw fields survive. */
function summarizeSnapshot(data, { now = () => new Date(), maxAgeMs = 15 * 60 * 1000 } = {}) {
  object(data);
  const currentDate = now instanceof Date ? now : new Date(typeof now === 'function' ? now() : now);
  const currentMilliseconds = currentDate.getTime();
  if (!Number.isFinite(currentMilliseconds) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) fail('invalid-schema');
  const latestObservation = currentMilliseconds + MAX_CLOCK_SKEW_MS;
  if (data.schemaVersion !== 1 || !SNAPSHOT_STATUSES.has(data.status)) fail('invalid-schema');
  const attemptedAt = timestamp(data.attemptedAt, latestObservation);
  const capturedAt = data.capturedAt === null ? null : timestamp(data.capturedAt, latestObservation);
  if (capturedAt && Date.parse(capturedAt) < Date.parse(attemptedAt)) fail('invalid-schema');

  const courseMap = new Map();
  const courses = list(data.courses, MAX_COURSES).map((raw) => {
    object(raw);
    const course = {
      key: text(raw.key, 500),
      name: text(raw.name, 300),
      term: text(raw.term, 80),
      status: raw.status,
    };
    if (!COURSE_STATUSES.has(course.status) || courseMap.has(course.key)) fail('invalid-schema');
    courseMap.set(course.key, course);
    return course;
  });

  const lessonKeys = new Set();
  const lessons = list(data.lessons, MAX_LESSONS).map((raw) => {
    object(raw);
    const key = text(raw.key, 500);
    const courseKey = text(raw.courseKey, 500);
    const course = courseMap.get(courseKey);
    if (!course || course.status !== 'complete' || lessonKeys.has(key)) fail('invalid-schema');
    lessonKeys.add(key);
    if (raw.courseName !== course.name || raw.term !== course.term) fail('invalid-schema');
    if (raw.progress !== null && (typeof raw.progress !== 'number' || !Number.isFinite(raw.progress) || raw.progress < 0 || raw.progress > 100)) {
      fail('invalid-schema');
    }
    const deadline = raw.deadline === null ? null : timestamp(raw.deadline);
    if (!['open', 'overdue', 'unknown'].includes(raw.deadlineState)) fail('invalid-schema');
    const observedAt = timestamp(raw.observedAt, latestObservation);
    if (!capturedAt || Date.parse(observedAt) > Date.parse(capturedAt) || Date.parse(observedAt) < Date.parse(attemptedAt)) fail('invalid-schema');
    return {
      key,
      courseKey,
      courseName: course.name,
      term: course.term,
      title: text(raw.title, 1000),
      progress: raw.progress,
      deadline,
      deadlineState: deadline === null ? 'unknown' : (Date.parse(deadline) < currentMilliseconds ? 'overdue' : 'open'),
      observedAt,
    };
  });

  const issues = list(data.issues, MAX_LESSONS).map((raw) => {
    object(raw);
    if (typeof raw.code !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/u.test(raw.code)) fail('invalid-schema');
    const issue = { code: raw.code };
    if (raw.courseKey !== undefined) {
      issue.courseKey = text(raw.courseKey, 500);
      if (!courseMap.has(issue.courseKey)) fail('invalid-schema');
    }
    return issue;
  });

  const failedCourses = courses.filter((course) => course.status !== 'complete').length;
  const successfulCourses = courses.length - failedCourses;
  const hasObservation = data.status === 'complete' || data.status === 'partial';
  if (hasObservation !== (capturedAt !== null)) fail('invalid-schema');
  if (data.status === 'complete' && failedCourses) fail('invalid-schema');
  if (data.status === 'partial' && (!successfulCourses || (!failedCourses && !issues.length))) fail('invalid-schema');
  if (!hasObservation && (lessons.length || successfulCourses)) fail('invalid-schema');

  const ageMs = capturedAt === null ? null : Math.max(0, currentMilliseconds - Date.parse(capturedAt));
  const counts = hasObservation ? { open: 0, overdue: 0, unknown: 0 } : null;
  if (counts) {
    for (const lesson of lessons) counts[lesson.deadlineState]++;
  }
  return {
    schemaVersion: 1,
    status: data.status,
    partial: data.status === 'partial',
    attemptedAt,
    capturedAt,
    asOf: currentDate.toISOString(),
    stale: ageMs === null || ageMs > maxAgeMs,
    ageMinutes: ageMs === null ? null : Math.floor(ageMs / 60000),
    counts,
    courses,
    lessons,
    issues,
  };
}

/** Read a bounded local regular file. This function never contacts KLAS. */
function readSnapshot(filename, options) {
  let descriptor;
  let contents;
  try {
    descriptor = fs.openSync(filename, 'r');
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) fail('snapshot-unavailable');
    if (stat.size > MAX_BYTES) fail('snapshot-too-large');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytes = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!bytes) break;
      length += bytes;
    }
    if (length > MAX_BYTES) fail('snapshot-too-large');
    contents = buffer.toString('utf8', 0, length);
  }
  catch (error) {
    fail(SAFE_ERRORS.has(error.code) ? error.code : 'snapshot-unavailable');
  }
  finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  let data;
  try { data = JSON.parse(contents); }
  catch { fail('invalid-json'); }
  return summarizeSnapshot(data, options);
}

module.exports = { readSnapshot, summarizeSnapshot };

if (require.main === module) {
  try {
    if (process.argv.length !== 3) fail('usage');
    process.stdout.write(`${JSON.stringify(readSnapshot(process.argv[2]), null, 2)}\n`);
  }
  catch (error) {
    const code = SAFE_ERRORS.has(error.code) ? error.code : 'snapshot-unavailable';
    process.stderr.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
  }
}
