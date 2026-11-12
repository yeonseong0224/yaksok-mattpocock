# 06: 본인 탈퇴와 방장 자동 승계

**What to build:** 참여자는 모집 중·마감·확정 언제든 스스로 나간다. 방장이 나가면 가장 먼저 들어온 active 참여자가 자동으로 방장이 되고, 남은 사람이 없으면 약속이 취소된다. 설정 중(draft)에 방장이 나가면 초안이 지워지고 링크가 처음 상태로 돌아간다.

스펙: User Stories 21~29. API: STATE-API-08. 규칙: MEMBER-10-01·10-03·11-01·12-01·12-03·12-04, STATE-06-01, C-07.

**Blocked by:** 05 (자동 취소가 취소 처리를 쓴다)

**Status:** done

- [x] `DELETE /promises/{id}/participants/me`: collecting·closed·confirmed. 참여자 `status=cancelled`, `cancelled_at`, 세션 즉시 만료, 쿠키 삭제. 슬롯 보존·집계 제외, 정원 제외, 버전 그대로
- [x] 방장이 나가면 같은 트랜잭션에서 `created_at ASC, id ASC` 첫 active 참여자를 host로. 없으면 약속 취소(방장 행 host·active 유지). 응답에 결과(새 방장, `promise_cancelled`)
- [x] draft에서 방장이 나가면 약속·방장 행 삭제, 링크 처음 상태, `{"result":"draft_discarded"}`
- [x] 확정 후 탈퇴: 확정 시각 유지, 참석 명단만 갱신. 2명 미만이면 기존 `hostActionRequired` 안내
- [x] 탈퇴자의 재로그인은 401 `UNAUTHENTICATED`(member.md MEMBER-API-04, C-07). 지금 코드(`lib/members/errors.ts`, `session.test.ts`)는 403 `PARTICIPANT_CANCELLED`를 쓰니 함께 바꾼다. 같은 닉네임 재참여는 기존처럼 거부
- [x] 이전 방장이 승계 뒤 보낸 방장 요청은 잠금 뒤 role 재확인으로 403
- [x] 방장과 다음 순번이 동시에 나가도 약속 행 잠금으로 직렬화된다
- [x] 화면: 약속 정보에 "이 약속에서 나가기" + 확인(방장은 승계 대상 또는 "약속이 취소돼요" 표시). 설정 중 화면에 "이 약속 없애기". 나간 뒤 첫 화면으로. 브라우저에서 수동 확인

## Comments

- 2026-11-12 구현 완료. 승계는 나가는 방장을 먼저 member·cancelled로 내린 뒤 후임을 host로 올린다(`uq_one_host_per_promise` 부분 유니크 인덱스).
- 이전 방장의 방장 요청: 탈퇴와 함께 그 사람의 모든 세션이 만료돼 실제로는 401에서 막힌다(테스트로 고정). 잠금 뒤 role 재확인(403)은 세션이 남는 경합에 대한 방어로 그대로 있다.
- `lib/members/errors.ts`의 탈퇴자 재로그인 응답을 401 UNAUTHENTICATED로 바꿨다(이름 `departedParticipantLogin`).
- 화면: "이 약속에서 나가기"는 참여자 명단 아래(사이드바·서랍·확정 결과·초대 링크 화면). 방장은 명단을 받은 뒤에 열 수 있고 승계 대상 또는 약속 취소를 알린다. 설정 중 화면에 "이 약속 없애기".
- 탈퇴 요청의 401은 성공으로 보지 않는다(`deleteJson`).
- 브라우저 확인 완료.
