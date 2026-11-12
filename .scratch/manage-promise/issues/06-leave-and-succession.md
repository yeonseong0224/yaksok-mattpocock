# 06: 본인 탈퇴와 방장 자동 승계

**What to build:** 참여자는 모집 중·마감·확정 언제든 스스로 나간다. 방장이 나가면 가장 먼저 들어온 active 참여자가 자동으로 방장이 되고, 남은 사람이 없으면 약속이 취소된다. 설정 중(draft)에 방장이 나가면 초안이 지워지고 링크가 처음 상태로 돌아간다.

스펙: User Stories 21~29. API: STATE-API-08. 규칙: MEMBER-10-01·10-03·11-01·12-01·12-03·12-04, STATE-06-01, C-07.

**Blocked by:** 05 (자동 취소가 취소 처리를 쓴다)

**Status:** ready-for-agent

- [ ] `DELETE /promises/{id}/participants/me`: collecting·closed·confirmed. 참여자 `status=cancelled`, `cancelled_at`, 세션 즉시 만료, 쿠키 삭제. 슬롯 보존·집계 제외, 정원 제외, 버전 그대로
- [ ] 방장이 나가면 같은 트랜잭션에서 `created_at ASC, id ASC` 첫 active 참여자를 host로. 없으면 약속 취소(방장 행 host·active 유지). 응답에 결과(새 방장, `promise_cancelled`)
- [ ] draft에서 방장이 나가면 약속·방장 행 삭제, 링크 처음 상태, `{"result":"draft_discarded"}`
- [ ] 확정 후 탈퇴: 확정 시각 유지, 참석 명단만 갱신. 2명 미만이면 기존 `hostActionRequired` 안내
- [ ] 탈퇴자의 재로그인은 401 `UNAUTHENTICATED`(member.md MEMBER-API-04, C-07). 지금 코드(`lib/members/errors.ts`, `session.test.ts`)는 403 `PARTICIPANT_CANCELLED`를 쓰니 함께 바꾼다. 같은 닉네임 재참여는 기존처럼 거부
- [ ] 이전 방장이 승계 뒤 보낸 방장 요청은 잠금 뒤 role 재확인으로 403
- [ ] 방장과 다음 순번이 동시에 나가도 약속 행 잠금으로 직렬화된다
- [ ] 화면: 약속 정보에 "이 약속에서 나가기" + 확인(방장은 승계 대상 또는 "약속이 취소돼요" 표시). 설정 중 화면에 "이 약속 없애기". 나간 뒤 첫 화면으로. 브라우저에서 수동 확인
