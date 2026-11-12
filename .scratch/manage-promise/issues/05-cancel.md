# 05: 약속 취소

**What to build:** 방장이 모집 중·마감·확정 약속을 취소한다. 되돌릴 수 없다는 확인을 거친다. 취소되면 모든 세션이 즉시 만료되고, 링크를 열면 누구에게나 "취소된 약속입니다"만 보인다. 설정 중(draft) 약속은 취소가 아니라 06의 "이 약속 없애기"로 지운다.

스펙: User Stories 18~20. API: STATE-API-07. 규칙: STATE-10-01/02, C-10.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `POST /promises/{id}/cancel`: 방장만, collecting·closed·confirmed만(draft는 `INVALID_PROMISE_STATE`). `status=cancelled`, `cancelled_at` 기록. 참여자 role·status는 그대로
- [x] 그 약속의 모든 세션을 즉시 만료하고 응답 쿠키를 지운다
- [x] 취소된 약속의 모든 조회·쓰기는 인증보다 먼저 `409 PROMISE_CANCELLED`. 링크 조회는 `promiseStatus: "cancelled"`
- [x] 화면: 방장 설정 팝업에 "약속 취소" + 되돌릴 수 없음 확인. 취소된 링크는 Figma 22 형식의 "취소된 약속입니다". 다른 참여자는 다음 조회(폴링 포함)에서 그 화면으로 바뀐다. 브라우저에서 수동 확인

## Comments

- 2026-11-12 구현 완료. 세션 만료는 `expireAllSessions`(행 보존, expires_at = 잠금 후 DB 시각). cancelled_at도 같은 시각.
- `/me`도 취소된 약속이면 인증보다 먼저 409 `PROMISE_CANCELLED`로 바꿨다(C-10 통일, member.md 반영). 링크 화면은 `/me` 결과보다 먼저 링크의 cancelled를 본다.
- 화면 전환: 어느 요청이든 `PROMISE_CANCELLED`를 받으면 링크를 다시 읽는다(api.ts 이벤트). 모집 시작 뒤에는 링크를 5초마다 다시 읽어 폴링하지 않는 화면(확정 결과, 참여 폼)도 바뀐다.
- 취소 화면: Figma 22 "취소된 약속" + 새 약속 만들기. Figma의 "읽기 전용" 문구는 스펙(취소 안내만 보인다)에 따라 뺐다.
- 04에서 미룬 후보 없음 안내의 "약속 취소"를 연결했다. 확정 결과 화면에는 따로 두지 않았다(방장 설정 팝업에서 가능).
- 브라우저 확인 완료.
