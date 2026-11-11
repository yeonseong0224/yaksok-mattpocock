# 07: 방장의 내보내기

**What to build:** 방장이 모집 중(마감 전)에 명단에서 참여자를 내보낸다. 내보내진 사람은 로그인이 풀리고 같은 닉네임으로 재참여할 수 없으며, 그 사람의 가능 시간은 집계와 후보에서 바로 빠진다.

스펙: User Stories 30~34. API: MEMBER-API-08. 규칙: MEMBER-10-02·11-02, STATE-06-01(1-2절로 변경).

**Blocked by:** 06 (멤버십 종료 처리 공유)

**Status:** ready-for-agent

- [ ] `DELETE /promises/{id}/participants/{participantId}`: 방장만, collecting·마감 전만. 자기 자신은 `CANNOT_REMOVE_SELF`, 없는 대상은 `PARTICIPANT_NOT_FOUND`, 이미 cancelled면 200(멱등)
- [ ] 06과 같은 멤버십 종료 처리(상태, 세션 만료, 집계·정원 제외, 버전 그대로)
- [ ] 마감이 지났으면 잠금 뒤 closed로 바꾸고 409(ADR-0001)
- [ ] 화면: 명단의 각 행(본인 제외)에 방장에게만, 모집 중일 때 "내보내기" + 확인. 내보내진 사람은 다음 조회에서 로그인 화면으로, "방장이 이 약속에서 내보냈어요" 안내(401 응답과 브라우저에 남은 이전 로그인 기억으로 구분). 데스크톱·모바일 서랍 모두. 브라우저에서 수동 확인
