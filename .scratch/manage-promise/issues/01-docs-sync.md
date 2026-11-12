# 01: 규칙·API 문서에 결정 반영

**What to build:** `DECISION_CONFLICTS.md` 1-2절(2026-11-11 결정)을 각 규칙 문서와 API 문서 본문에 반영한다. 첫 슬라이스처럼 해당 규칙 ID 아래에 `(2026-11-11 결정)`으로 적고, 바뀌는 오류 코드와 처리 순서를 API 문서에서 고친다.

스펙: `.scratch/manage-promise/spec.md` 「근거 문서」「API 계약」「Further Notes」.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] STATE·MEMBER·TIME·RESULT 규칙 문서에서 1-2절의 규칙 ID마다 결정문을 반영한다(미결 → 결정, 충돌 문구 수정: STATE-01-01·04-01 마감 단축·정원 감소, STATE-06-01 내보내기 시점, STATE-09-01 closed 재조율, STATE-10-02/03, MEMBER-07-03·10-01·10-02·11-02·12-02·12-04, TIME-14-03/04, TIME-11-02·X-07)
- [x] state.md STATE-API-03: `DEADLINE_SHORTEN_NOT_ALLOWED` 삭제, 정원 감소 오류를 `CAPACITY_BELOW_ACTIVE_COUNT`로, "범위 변경을 재조율로 취급" 문구를 재설정으로 정리, "3개월" 경고 삭제
- [x] state.md STATE-API-06·07·08: 허용 상태를 1-2절대로. STATE-API-08 처리 순서 번호 정리(X-11), STATE-API-09 복사본 정리(X-10)
- [x] member.md MEMBER-API-08: 미완성 부분(A-02) 채우기, 허용 시점 "모집 중·마감 전", 탈퇴·내보내진 사람의 재로그인 401(C-07)
- [x] time.md 10/13 결정(재제출 전 미제출)을 X-07 결정으로 바꾼다
- [x] DECISION_CONFLICTS.md 3절(미결 목록)·4절(모순)에서 해소된 항목 표시
- [x] 코드 변경 없음. prettier 통과

## Comments

- 2026-11-12 구현(`docs/manage-promise-rules`). 커밋을 둘로 나눴다: prettier 정렬만 한 커밋(내용 변경 없음) + 내용 커밋.
  - STATE-API-09는 본문이 STATE-API-08 복사본이었고 원래 내용을 알 수 없어, 복사본을 지우고 STATE-API-00과 각 API 0절을 가리키는 한 줄로 바꿨다.
  - C-06: 탈퇴·내보내기 때 세션은 행 삭제 없이 즉시 만료(`expires_at`=현재 시각). MEMBER-API-05·07의 "전부 삭제" 문구를 고쳤다. 로그아웃만 행을 삭제한다.
  - 재조율(STATE-API-06)의 새 마감도 재설정·모집 시작과 같은 규칙(현재+30분 이상, 마지막 날 00:00 KST 미만).
  - 코드와 어긋나는 점: 탈퇴자 재로그인 401(C-07)은 코드가 아직 403이다. 티켓 06에서 바꾼다.
