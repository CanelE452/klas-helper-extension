'use strict';

const { normalizeCourses, normalizeLessons, MAX_LESSONS } = require('./model.cjs');

const ENDPOINT = '/std/lis/evltn/SelectOnlineCntntsStdList.do';

function failure(code) {
  const error = new Error(code);
  error.monitorCode = code;
  return error;
}

function timestamp(now) {
  return new Date(now()).toISOString();
}

async function readCourse(course, fetchImpl, now, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const fetchRows = async () => {
    let response;
    try {
      const [term, subject] = course.key.split('::').map(decodeURIComponent);
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'manual',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ selectSubj: subject, selectYearhakgi: term, selectChangeYn: 'Y' }),
        signal: controller.signal,
      });
    }
    catch {
      throw failure(controller.signal.aborted ? 'timeout' : 'offline');
    }
    const contentType = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') || '' : '';
    if (response.status === 401 || response.status === 403 || response.redirected || response.type === 'opaqueredirect' || /text\/html/i.test(contentType)) throw failure('auth-required');
    if (!response.ok) throw failure('http-error');
    if (!/application\/(?:[a-z0-9.+-]*\+)?json/i.test(contentType)) throw failure('invalid-response');
    let rows;
    try { rows = await response.json(); }
    catch { throw failure('invalid-json'); }
    if (!Array.isArray(rows)) throw failure('invalid-response');
    if (rows.length > MAX_LESSONS) throw failure('too-many-lessons');
    const observedAt = timestamp(now);
    return { ...normalizeLessons(course, rows, observedAt), observedAt, status: 'complete' };
  };
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(failure('timeout'));
      }, timeoutMs);
    });
    return await Promise.race([fetchRows(), timeout]);
  }
  catch (error) {
    const code = error && error.monitorCode || 'invalid-response';
    const status = code === 'auth-required' ? 'auth-required' : code === 'offline' ? 'offline' : 'error';
    return { lessons: [], issues: [{ code, courseKey: course.key }], observedAt: null, status };
  }
  finally {
    clearTimeout(timer);
  }
}

async function collectSnapshot(rawCourses, options = {}) {
  const { fetchImpl = globalThis.fetch, now = () => new Date() } = options;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(60000, options.timeoutMs)) : 15000;
  const concurrency = Number.isFinite(options.concurrency) ? Math.max(1, Math.min(6, Math.floor(options.concurrency))) : 3;
  const attemptedAt = timestamp(now);
  const normalized = normalizeCourses(rawCourses);
  const snapshot = { schemaVersion: 1, attemptedAt, capturedAt: null, status: 'error', courses: [], lessons: [], issues: normalized.issues };
  if (normalized.courses.length === 0) {
    if (Array.isArray(rawCourses) && rawCourses.length === 0) {
      snapshot.status = 'complete';
      snapshot.capturedAt = timestamp(now);
    }
    return snapshot;
  }
  const results = new Array(normalized.courses.length);
  let next = 0;
  const worker = async () => {
    while (next < normalized.courses.length) {
      const index = next++;
      results[index] = await readCourse(normalized.courses[index], fetchImpl, now, timeoutMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, normalized.courses.length) }, worker));
  for (const [index, result] of results.entries()) {
    if (snapshot.lessons.length + result.lessons.length > MAX_LESSONS) {
      result.status = 'error';
      result.lessons = [];
      result.observedAt = null;
      result.issues = [{ code: 'snapshot-too-large', courseKey: normalized.courses[index].key }];
    }
    snapshot.courses.push({ ...normalized.courses[index], status: result.status });
    snapshot.lessons.push(...result.lessons);
    snapshot.issues.push(...result.issues);
  }
  const successes = results.filter((result) => result.status === 'complete');
  if (successes.length > 0) {
    snapshot.capturedAt = timestamp(now);
    const hasDataIssue = snapshot.issues.some(({ code }) => code !== 'duplicate-course');
    snapshot.status = successes.length === results.length && !hasDataIssue ? 'complete' : 'partial';
  }
  else if (results.some(({ status }) => status === 'auth-required')) snapshot.status = 'auth-required';
  else if (results.every(({ status }) => status === 'offline')) snapshot.status = 'offline';
  return snapshot;
}

module.exports = { collectSnapshot };
