# Read-only lecture monitor

## Goal and decisions

Show public, unfinished online lessons, including overdue lessons, with progress,
KST deadlines, and observation times. Use the existing browser KLAS session. Never
collect credentials or change attendance, playback, submissions, or authentication.

The implementation decision is a separate Chrome MV3 extension build, limited to
the KLAS home page. It does not load the original extension app, video features,
background script, keepalive, storage, or third-party assets. A user clicks refresh;
there is no scheduler. A JSON snapshot is downloaded only on explicit request.
Codex/dot can read that local file with the supplied Node CLI. This is a manual
snapshot connection, not live MCP registration or continuous monitoring.

## Data contract (schemaVersion 1)

Snapshot fields: schemaVersion, attemptedAt, capturedAt, status, courses, lessons,
issues. Status is complete/partial/error/auth-required/offline. capturedAt is the
time of this successful or partially successful observation; null if all failed.
courses contain key, name, term, status. lessons contain key, courseKey,
courseName, term, title, progress (number or null), deadline (ISO or null),
deadlineState (open/overdue/unknown), observedAt. issues contain code and optional
courseKey only. Raw server messages, student identifiers, cookies and arbitrary
response fields must never appear. DOM rendering uses textContent.

Known course fields are subj, subjNm, yearhakgi. Known lesson fields are evltnSe,
isonoff, prog and endDate from upstream home.js. Public KLAX code also documents
sbjt/sdesc/title and expiredate/expireDate aliases; it is only read as reference,
never installed or used for login. Unknown titles receive a row label. Invalid
progress remains unknown, never completed. Invalid deadlines remain unknown.
Naive dates are KST. Minute-precision deadlines include the entire minute, matching
the upstream :59 convention. The exact final millisecond is still open.

Deduplicate courses by term+subject; no confirmed unique lesson ID is available,
so preserve separate lesson rows even when titles match. Record a schema limitation
in the guide. Filter OFF and non-lesson rows; completed numeric/string 100 excluded.

## Failures and privacy

Only the fixed same-origin SelectOnlineCntntsStdList.do endpoint is called, with
the three upstream selector fields. Bound requests and timeouts. Reject redirects,
HTML/login pages, non-array responses and invalid courses. Mark partial success;
never present failed courses as zero unfinished lessons. Keep last good UI results
on failure with their original timestamp. Reject overlapping refreshes and clear
the previous selection when the current course set changes. No console logging of
payloads, persistence, external transmission, or credential fallback.

Export only a fresh result for the current selection; stale/error state disables
export. Files remain private in Downloads and must not be added to Git. The reader
validates and reconstructs the whitelist, reports staleness and reclassifies
deadlines at read time without claiming a fresh KLAS observation.

## Implementation and verification plan

1. Core model and collector: write failing Node tests, then implement normalization,
   date boundaries, invalid data, deduplication and classified request failures.
2. Browser UI and standalone build: refresh, status, table, manual JSON download;
   test DOM escaping and stale/overlapping state using a virtual browser fixture.
3. Local reader: tests first for schema validation, old/partial/error snapshots,
   private extra fields, malformed files and deadline reclassification.
4. Run complete new suite, repository lint, original build and monitor build.
   Inspect packaged manifest/assets; use only synthetic fixtures for runtime checks.
5. Independent review, publish only source/docs/tests to the user's fork, make an
   installable local ZIP. Real extension installation needs action-time approval;
   login must be completed by the user in KLAS. Report this boundary accurately.

## Source references

- Upstream: 2746fced16a41a516761d4af68223fd232e8c442, src/routes/home.js.
- KLAX reference only: 65cf39c4b624702a4e3d5f8ef13b0ecb9c9b5b78,
  src/klax/client.py lines 722–738 and tests/test_academic_tools.py lines 410–470.

The user delegated implementation choices and authorized development and the public
fork. The design and execution choices above are the implementer's decisions.
