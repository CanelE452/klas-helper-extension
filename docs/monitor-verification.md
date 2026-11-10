# 검증 결과 및 적용 상태

검증일: 2026-11-10. 실계정·학번·비밀번호 없이 가상 데이터만 사용했습니다.

## 산출물

- 원본 기준: `kw-service/klas-helper-extension@2746fced16a41a516761d4af68223fd232e8c442`
- 사용자 공개 포크: <https://github.com/CanelE452/klas-helper-extension>
- 로컬 작업 폴더: `C:/Users/User/Documents/Codex/2026-11-10/task/klas-helper-extension`
- 전용 확장 폴더: `dist-monitor`
- 로컬 설치 ZIP: `artifacts/klas-readonly-monitor-0.1.0.zip` (6,749 bytes)
- ZIP SHA-256: `A2D6D6F4DE4F6085C1DF68FDBAC1AF61CE374D98BDEE8D977D743FC92C1871B0`
- monitor.js SHA-256: `D37FB6342EA930E4F53504048B3E57035B46C6098594824815BF4458266067A7`
- manifest.json SHA-256: `0E1BFF25C0B64E70E1BE277DE37DA6B6EE2FC4E2D2C6424742DDCBEB5EED9D71`

ZIP과 빌드 폴더는 로컬 산출물이고 공개 Git에는 소스·문서·가상 테스트만 포함합니다.
ZIP의 타임스탬프 등으로 재압축 시 ZIP 해시는 달라질 수 있습니다.

## 실행 결과

| 확인 | 결과 |
| --- | --- |
| `npm test` | 40/40 통과, 실패·취소·스킵 0 |
| `npm run lint:monitor` | 오류·경고 0 |
| `npm run build:monitor` | 성공, monitor.js 약 11.8KiB |
| `npm run build` 원본 전체 빌드 | 성공, 원본의 webpack 경고 5개 |
| `npm run lint` 원본 기본 검사 | Windows checkout CRLF로 linebreak-style 오류 4,010개, 기존 unused 경고 12개 |
| `npm run lint -- --rule 'linebreak-style: off'` | 오류 0, 기존 unused 경고 12개 |
| `git diff --check` | 통과 |
| 전용 패키지 파일 검사 | LICENSE/manifest.json/monitor.js만 포함 |
| 독립 코드 리뷰 | 초기 빈 목록·크기 한도·리다이렉트·잘못된 selector 보완 후 전체 재검증 |

의존성은 기존 package-lock.json으로 `npm ci --ignore-scripts` 설치했습니다.
전역 Git 설정이나 GitHub CLI 인증정보를 바꾸지 않았습니다. 전역적인 줄바꿈 수정도
하지 않았습니다. Git 소유자 경고는 해당 저장소에 대한 명령별 safe.directory 옵션으로
처리했습니다.

모델·수집기 테스트는 마감 직전/정각/직후, KST, 불가능한 날짜, 숫자/문자열 100,
잘못된 진도, 숨김/다른 종류 항목, 중복 과목, 동일 제목 차시 보존, 인증 만료,
수동 리다이렉트, HTML, 401/403, 네트워크 실패, 타임아웃, 잘못된 JSON/배열,
부분 실패, 요청 동시성·전체 행 수 한도, 제어문자·단독 surrogate를 확인했습니다.

판독기·화면 테스트는 스키마 및 시각·관계 검증, 허용 필드 재구성, 미존재/큰 파일,
HTML/잘못된 JSON, 민감해 보이는 추가 필드 제외, 오래된 결과, 읽는 시각 기준 마감
재분류, 재조회 실패 시 마지막 결과 유지, 중복 클릭, 학기 전환 중 응답 폐기,
초기 빈 수강목록 차단, 큰 스냅샷 저장 차단을 확인했습니다.

## 실제 Chrome에서 확인한 경로

일시적인 localhost 가상 페이지에서 **최종 production monitor.js**를 실행했습니다.
원본 KLAS 계정·API에는 접속하지 않았습니다.

1. 정상 조회: 마감 전 2개·마감 지난 1개 표시. 완료·비공개 강의 제외.
2. HTML처럼 생긴 강의명이 실제 HTML로 실행되지 않고 텍스트로 표시됨.
3. 로그인 만료: 이전 조회시각 보존, 오래된 결과 안내, 저장 버튼 비활성화.
4. 일부 과목 실패: 부분 결과 안내와 부분 스냅샷 상태 표시.
5. 오프라인: 이전 결과 보존, 재조회 안내, 저장 비활성화.
6. 학기 변경: 기존 행과 결과 시각을 비우고 재조회 안내.
7. 정상 JSON을 Chrome 다운로드 버튼으로 저장.
8. 이 작업의 로컬 실행 도구에서 실제 다운로드 파일을 `scripts/read-monitor.cjs`로 읽음:
   `status: complete`, `stale: false`, `counts: {open:2, overdue:1, unknown:0}`.

검증용 localhost 서버는 테스트 후 종료했습니다. 브라우저 다운로드 이벤트 대기 도구는
시간초과됐지만 실제 다운로드 파일의 생성과 CLI 판독 성공을 별도로 확인했습니다.
가상 파일은 공개 저장소에 넣지 않았습니다.

## 연결의 한계와 남은 단계

**로컬 스냅샷 경로만 검증됨. 실제 KLAS 현황과 상시 모니터링은 미검증/미구성입니다.**

- 새 확장을 설치할 시점의 승인이 필요합니다. 적용 승인 전에는 설치하지 않습니다.
- 사용자 직접 KLAS 로그인 후 홈 DOM과 최신 API 스키마를 실계정에서 확인해야 합니다.
- JSON 저장은 수동입니다. 파일이 자동 갱신되지 않으며 Node CLI는 KLAS에 접속하지 않습니다.
- MCP 서버·dot 도구 등록·예약 작업·자동 알림·OS 서비스는 생성하지 않았습니다.
- 이 작업에서는 dot의 로컬 작업 실행 경로로 CLI를 호출했습니다. 로컬 실행 도구가 없는
  다른 dot 세션은 로컬 작업 위임이나 별도 연결이 필요합니다.
- 검증된 강의 고유 ID·강의 시작일 필드가 없습니다. 같은 제목의 차시는 보존하며,
  목록에 있더라도 수강 가능 시작 시각까지 검증했다는 의미는 아닙니다.

설치와 재로그인 후에는 `README-MONITOR.md`의 절차로 최신 스냅샷을 저장하고 판독합니다.
인증정보를 채팅·로그·코드로 전달할 필요가 없습니다.
