# 05: 약속 취소

**What to build:** 방장이 모집 중·마감·확정 약속을 취소한다. 되돌릴 수 없다는 확인을 거친다. 취소되면 모든 세션이 즉시 만료되고, 링크를 열면 누구에게나 "취소된 약속입니다"만 보인다. 설정 중(draft) 약속은 취소가 아니라 06의 "이 약속 없애기"로 지운다.

스펙: User Stories 18~20. API: STATE-API-07. 규칙: STATE-10-01/02, C-10.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `POST /promises/{id}/cancel`: 방장만, collecting·closed·confirmed만(draft는 `INVALID_PROMISE_STATE`). `status=cancelled`, `cancelled_at` 기록. 참여자 role·status는 그대로
- [ ] 그 약속의 모든 세션을 즉시 만료하고 응답 쿠키를 지운다
- [ ] 취소된 약속의 모든 조회·쓰기는 인증보다 먼저 `409 PROMISE_CANCELLED`. 링크 조회는 `promiseStatus: "cancelled"`
- [ ] 화면: 방장 설정 팝업에 "약속 취소" + 되돌릴 수 없음 확인. 취소된 링크는 Figma 22 형식의 "취소된 약속입니다". 다른 참여자는 다음 조회(폴링 포함)에서 그 화면으로 바뀐다. 브라우저에서 수동 확인
