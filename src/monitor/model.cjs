'use strict';

const MAX_COURSES = 100;
const MAX_LESSONS = 10000;

function text(value, limit) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
}

function selector(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return '';
  const trimmed = value.trim();
  if (trimmed.length > 80) return '';
  try { encodeURIComponent(trimmed); }
  catch { return ''; }
  return trimmed;
}

function courseKey(term, subject) {
  return `${encodeURIComponent(term)}::${encodeURIComponent(subject)}`;
}

function parseDeadline(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const [, yy, mm, dd, hh, mi, ss, ms, zone] = match;
  const year = Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  const hour = Number(hh);
  const minute = Number(mi);
  const second = ss === undefined ? 59 : Number(ss);
  const millis = ss === undefined ? 999 : Number((ms || '').padEnd(3, '0'));
  if (year < 1000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  let offsetMinutes = 540;
  if (zone === 'Z') offsetMinutes = 0;
  else if (zone) {
    const compact = zone.replace(':', '');
    const hours = Number(compact.slice(1, 3));
    const minutes = Number(compact.slice(3, 5));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
    offsetMinutes = (hours * 60 + minutes) * (zone[0] === '-' ? -1 : 1);
  }
  return new Date(utc - offsetMinutes * 60000).toISOString();
}

function normalizeCourses(raw) {
  const courses = [];
  const issues = [];
  if (!Array.isArray(raw)) return { courses, issues: [{ code: 'invalid-courses' }] };
  if (raw.length > MAX_COURSES) return { courses, issues: [{ code: 'too-many-courses' }] };
  const seen = new Set();
  for (const entry of raw) {
    const subject = entry && typeof entry === 'object' && !Array.isArray(entry) ? selector(entry.subj) : '';
    const term = entry && typeof entry === 'object' ? selector(entry.yearhakgi) : '';
    if (!subject || !term) {
      issues.push({ code: 'invalid-course' });
      continue;
    }
    const key = courseKey(term, subject);
    if (key.length > 470) {
      issues.push({ code: 'invalid-course' });
      continue;
    }
    if (seen.has(key)) {
      issues.push({ code: 'duplicate-course', courseKey: key });
      continue;
    }
    seen.add(key);
    courses.push({ key, name: text(entry.subjNm, 300) || `과목 ${courses.length + 1}`, term });
  }
  return { courses, issues };
}

function normalizeLessons(course, rows, observedAt) {
  const lessons = [];
  const issueCodes = new Set();
  if (!Array.isArray(rows)) return { lessons, issues: [{ code: 'invalid-response', courseKey: course.key }] };
  if (rows.length > MAX_LESSONS) return { lessons, issues: [{ code: 'too-many-lessons', courseKey: course.key }] };
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.evltnSe !== 'string' || !row.evltnSe) {
      issueCodes.add('invalid-row');
      continue;
    }
    if (row.evltnSe !== 'lesson' || row.isonoff === 'OFF') continue;
    const rawProgress = row.prog;
    let progress = null;
    if (typeof rawProgress === 'number' || (typeof rawProgress === 'string' && /^\d+(?:\.\d+)?$/.test(rawProgress.trim()))) {
      const parsed = Number(rawProgress);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) progress = parsed;
    }
    if (progress === 100) continue;
    if (progress === null) issueCodes.add('invalid-progress');
    const deadline = parseDeadline(row.endDate || row.expiredate || row.expireDate);
    if (deadline === null) issueCodes.add('invalid-deadline');
    const title = text(row.sbjt, 1000) || text(row.sdesc, 1000) || text(row.title, 1000) || `강의 ${index + 1}`;
    lessons.push({
      key: `${course.key}::row-${index + 1}`,
      courseKey: course.key,
      courseName: course.name,
      term: course.term,
      title,
      progress,
      deadline,
      deadlineState: deadline === null ? 'unknown' : Date.parse(deadline) < Date.parse(observedAt) ? 'overdue' : 'open',
      observedAt,
    });
  }
  return { lessons, issues: [...issueCodes].map((code) => ({ code, courseKey: course.key })) };
}

module.exports = { parseDeadline, normalizeCourses, normalizeLessons, MAX_COURSES, MAX_LESSONS };
