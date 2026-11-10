function selectionKey(courses) {
  if (!Array.isArray(courses)) return null;
  return JSON.stringify(courses.map((c) => [c?.yearhakgi, c?.subj, c?.subjNm]).sort());
}

function createMonitorController({ getCourses, collect, download = () => {}, onChange = () => {} }) {
  let selected = null;
  let state = { busy: false, snapshot: null, lastAttempt: null, stale: false, canExport: false, messageCode: 'ready' };
  const notify = () => onChange({ ...state });
  const coursesNow = () => {
    try { return getCourses(); }
    catch { return null; }
  };
  const selectionChanged = () => {
    const current = selectionKey(coursesNow());
    if (selected !== null && current !== selected) {
      selected = current;
      state = { ...state, snapshot: null, lastAttempt: null, stale: false, canExport: false, messageCode: 'selection-changed' };
      notify();
      return true;
    }
    return false;
  };
  return {
    getState: () => ({ ...state }),
    selectionChanged,
    async refresh() {
      if (state.busy) return;
      selectionChanged();
      const courses = coursesNow();
      const requestSelection = selectionKey(courses);
      if (requestSelection === null || courses.length === 0) {
        state = { ...state, canExport: false, stale: Boolean(state.snapshot), messageCode: 'courses-unavailable' };
        notify();
        return;
      }
      selected = requestSelection;
      state = { ...state, busy: true, canExport: false, messageCode: 'loading' };
      notify();
      let attempt;
      try { attempt = await collect(courses); }
      catch { attempt = { status: 'error', capturedAt: null }; }
      if (requestSelection !== selectionKey(coursesNow())) {
        state = { ...state, busy: false, snapshot: null, lastAttempt: null, canExport: false, stale: false, messageCode: 'selection-changed' };
      }
      else {
        const usable = Boolean(attempt.capturedAt) && ['complete', 'partial'].includes(attempt.status);
        const tooLarge = usable && (attempt.lessons.length > 10000 || new TextEncoder().encode(JSON.stringify(attempt, null, 2)).length > 2 * 1024 * 1024);
        state = {
          ...state,
          busy: false,
          lastAttempt: attempt,
          snapshot: usable ? attempt : state.snapshot,
          canExport: usable && !tooLarge,
          stale: !usable && Boolean(state.snapshot),
          messageCode: tooLarge ? 'snapshot-too-large' : attempt.status,
        };
      }
      notify();
    },
    exportSnapshot() {
      if (selectionChanged() || !state.canExport || state.busy) return false;
      download(state.snapshot);
      return true;
    },
  };
}

const messages = {
  ready: '조회 버튼을 눌러 현재 학기의 미수강 강의를 확인하세요.',
  loading: 'KLAS 강의 목록을 조회하고 있습니다…',
  complete: '조회 완료. 아래 결과는 표시된 조회시각의 스냅샷입니다.',
  partial: '일부 과목 또는 데이터 확인에 실패했습니다. 전체 미수강 목록으로 단정하지 마세요.',
  error: '조회에 실패했습니다. KLAS 로그인과 연결 상태를 확인하고 다시 조회하세요.',
  'auth-required': '로그인이 필요하거나 세션이 만료되었습니다. KLAS에서 직접 로그인한 뒤 홈으로 돌아오세요.',
  offline: '네트워크 연결을 확인한 뒤 다시 조회하세요.',
  'courses-unavailable': '수강 과목을 확인할 수 없습니다. KLAS에 직접 로그인한 뒤 홈 로딩을 기다리고 다시 조회하세요.',
  'selection-changed': '학기 또는 과목이 변경되었습니다. 다시 조회하세요.',
  'snapshot-too-large': '결과가 로컬 판독기 한도(2MiB 또는 강의 10,000개)를 초과하여 JSON 저장을 중단했습니다. 화면에서 조회시각과 결과를 확인하세요.',
};

function formatTime(value) {
  if (!value) return '확인 불가';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function mountMonitor({ document, getCourses, collect, download }) {
  if (document.getElementById('klas-readonly-monitor')) return null;
  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const panel = el('section');
  panel.id = 'klas-readonly-monitor';
  panel.setAttribute('aria-label', '미수강 강의 읽기 전용 모니터');
  panel.style.cssText = 'background:#fff;color:#172a3a;border:2px solid #435a83;border-radius:12px;padding:20px;margin:16px 0;font:14px/1.6 sans-serif;overflow:auto';
  panel.append(el('h2', '미수강 강의 · 읽기 전용'));
  panel.append(el('p', '마감 전·지난 공개 강의를 함께 조회합니다. 자동 재생·출석·제출 기능은 없습니다.'));
  const refresh = el('button', '강의 현황 조회');
  const exportButton = el('button', 'JSON 스냅샷 저장');
  refresh.type = exportButton.type = 'button';
  refresh.style.cssText = exportButton.style.cssText = 'padding:8px 14px;margin:0 8px 8px 0;cursor:pointer';
  exportButton.disabled = true;
  const status = el('p', messages.ready);
  status.setAttribute('role', 'status');
  const timing = el('p');
  const summary = el('p');
  const table = el('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;text-align:left';
  const head = el('thead');
  const headings = el('tr');
  for (const title of ['과목', '강의', '진도', '마감 (한국시간)', '분류', '조회시각 (한국시간)']) {
    const th = el('th', title);
    th.scope = 'col';
    th.style.cssText = 'padding:8px;border-bottom:1px solid #aaa;white-space:nowrap';
    headings.append(th);
  }
  head.append(headings);
  const body = el('tbody');
  table.append(head, body);
  panel.append(refresh, exportButton, status, timing, summary, table, el('p', '저장은 수동입니다. 파일에는 수업 현황이 포함됩니다. 비공개 위치에 보관하고 필요한 경우에만 Codex/dot에서 읽으세요.'));
  (document.querySelector('.subjectbox') || document.body).prepend(panel);
  const controller = createMonitorController({
    getCourses,
    collect,
    download,
    onChange(state) {
      refresh.disabled = state.busy;
      exportButton.disabled = !state.canExport;
      status.textContent = (messages[state.messageCode] || messages.error) + (state.stale ? ' 아래에는 이전 조회 결과를 표시하며 현재 상태가 아닙니다.' : '');
      timing.textContent = state.snapshot ? `마지막 결과: ${formatTime(state.snapshot.capturedAt)}${state.lastAttempt?.attemptedAt ? ` / 마지막 시도: ${formatTime(state.lastAttempt.attemptedAt)}` : ''}` : '';
      body.replaceChildren();
      if (!state.snapshot) { summary.textContent = ''; return; }
      const lessons = state.snapshot.lessons;
      const count = (key) => lessons.filter((row) => row.deadlineState === key).length;
      summary.textContent = `마감 전 ${count('open')}개 · 마감 지남 ${count('overdue')}개 · 마감 확인 불가 ${count('unknown')}개${state.snapshot.status === 'partial' ? ' (부분 결과)' : ''}`;
      if (!lessons.length) summary.textContent += state.snapshot.status === 'complete' ? ' · 공개된 미완료 강의가 없습니다.' : ' · 확인한 범위 내 결과이며 누락 가능성이 있습니다.';
      for (const lesson of lessons) {
        const row = el('tr');
        const cells = [lesson.courseName, lesson.title, lesson.progress === null ? '확인 불가' : `${lesson.progress}%`, formatTime(lesson.deadline),
          { open: '마감 전', overdue: '마감 지남', unknown: '마감 확인 불가' }[lesson.deadlineState], formatTime(lesson.observedAt)];
        for (const value of cells) {
          const td = el('td', value);
          td.style.cssText = 'padding:8px;border-bottom:1px solid #ddd';
          row.append(td);
        }
        body.append(row);
      }
    },
  });
  refresh.addEventListener('click', () => { void controller.refresh(); });
  exportButton.addEventListener('click', () => controller.exportSnapshot());
  return controller;
}

module.exports = { createMonitorController, mountMonitor };
