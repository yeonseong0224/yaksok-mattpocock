# 02: 설정 변경 영향 계산 모듈

**What to build:** 재설정과 재조율이 함께 쓰는 순수 모듈. 이전·새 설정(날짜 범위, 정원, 마감)과 active 참여자별 슬롯·제출 여부, 서버 시각을 받아 지울 슬롯, 버전을 올릴 참여자, 제출 상태를 풀 참여자, 검증 오류를 돌려준다. DB와 시계에 의존하지 않는다.

스펙: 「모듈 / 설정 변경 영향 계산」. 규칙: STATE-04-02, 09-03, 09-04, MEMBER-07-03, TIME-04-01~03, TIME-14-01~04.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 새 범위 밖 슬롯은 지우고 안쪽은 유지한다. 슬롯이 실제로 지워진 참여자만 버전 +1
- [x] 고를 수 있는 슬롯이 하나라도 늘면(확대·이동) active 전원 제출 상태 해제 + 버전 +1. 줄기만 하면 제출 상태 유지
- [x] 이름·정원·마감만 바뀌면 슬롯·버전·제출 상태 그대로
- [x] 정원 2~30, active 인원 미만이면 `CAPACITY_BELOW_ACTIVE_COUNT`
- [x] 날짜 범위: 새로 고르는 시작일은 오늘(KST)부터, 양 끝 포함 최대 90일. 이미 지난 기존 시작일을 그대로 두는 것은 허용
- [x] 마감: 지금+30분 이상, 범위 마지막 날 00:00 KST 미만. 연장·단축 모두 허용
- [x] 위 규칙을 표 형태 단위 테스트로 검증한다

## Comments

- 2026-11-12 구현(`feat/change-impact`): `lib/promises/change-impact.ts`의 `planSettingsChange`.
  - 출력: 검증된 설정, `rangeGrew`(확대·이동이면 active 전원 제출 상태 해제), `removedSlots`(참여자별 지울 슬롯), `versionBumped`. 제출 상태를 풀 참여자 목록은 따로 두지 않고 `rangeGrew`면 전원이다.
  - 검증은 모집 시작의 `validateStartSettings`를 다시 쓴다. 이미 지난 기존 시작일을 허용하려고 `keptStartDate` 옵션을 더했고, 달력용 `canStartOn`·`canEndOn`도 같은 옵션을 받는다(티켓 03 설정 폼용).
  - 정원 인원 부족은 `SettingsError.code = "CAPACITY_BELOW_ACTIVE_COUNT"`로 구분한다. 2~30 범위 오류가 있으면 겹쳐 내지 않는다.
  - 재조율에서 날짜 범위·정원을 보내지 않으면 라우트가 현재 값으로 채워 넘긴다(티켓 04).
  - GLOSSARY의 재설정 정의를 2026-11-11 결정에 맞게 고쳤다.
