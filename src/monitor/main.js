/* global appModule */
const { collectSnapshot } = require('./collect.cjs');
const { mountMonitor } = require('./ui.cjs');

const controller = mountMonitor({
  document,
  getCourses: () => typeof appModule === 'undefined' ? null : appModule.atnlcSbjectList,
  collect: (courses) => collectSnapshot(courses),
  download(snapshot) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'klas-monitor.snapshot.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
});

// Vue can replace the course list when the semester is changed. This watcher only
// invalidates an existing result; it never triggers a request or keeps a session alive.
if (controller && typeof appModule !== 'undefined' && typeof appModule.$watch === 'function') {
  appModule.$watch('atnlcSbjectList', () => controller.selectionChanged(), { deep: true });
}
