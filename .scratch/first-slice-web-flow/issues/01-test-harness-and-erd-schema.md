# 01: 테스트 하네스와 ERD 스키마

**What to build:** 이후 모든 티켓이 기대는 기반을 만든다. 연결 확인용 임시 User 모델을 ERD의 테이블 5개(promise_links, promises, participants, participant_available_slots, participant_sessions)로 바꾸고, health 엔드포인트가 새 스키마로 DB 연결을 확인하게 한다. Vitest와 테스트 DB를 도입해 주 seam("라우트 핸들러에 Request를 넣고 Response를 검증")을 쓸 수 있게 하고, CI에서도 같은 테스트를 돌린다. 화면은 없다(사전 작업).

스펙: `.scratch/first-slice-web-flow/spec.md` (스키마, Testing Decisions)

**Blocked by:** None (can start immediately)

**Status:** done

- [x] 마이그레이션을 `prisma migrate dev`로 만들고, ERD 4.1·4.2의 UNIQUE, FK(ON DELETE RESTRICT), CHECK와 "방장은 약속당 한 명" 부분 UNIQUE 인덱스를 넣는다
- [x] 모든 시점 컬럼은 Timestamptz(3), 하루 시간 범위는 SMALLINT 분 값이다. PIN 실패 제한 컬럼은 만들지 않는다
- [x] promises에 약속 이름(`title`) 컬럼이 있다(ERD 3.2, 2026-11-09 추가). collecting 이상의 상태에서는 필수다
- [x] health 엔드포인트가 새 스키마로 동작하고, 이를 호출하는 첫 HTTP seam 테스트가 통과한다
- [x] 테스트는 로컬 Docker Postgres 안의 별도 테스트 데이터베이스를 쓰고, 테스트마다 비운다. 개발 DB는 건드리지 않는다
- [x] 라우트 핸들러 호출 도우미(쿠키 주고받기 포함)가 있어서, 다음 티켓이 바로 흐름 테스트를 쓸 수 있다
- [x] `npm test` 스크립트가 있고, CI에 Postgres 17 서비스, 마이그레이션 적용, 테스트 단계를 추가해 통과한다
- [x] `db push`는 쓰지 않는다

## Comments

- 2026-11-09: 구현 완료(`feat/test-harness-erd-schema`). 약속 이름 30자 상한은 grapheme 기준이라 DB CHECK에서 빼고 서버 검증(03)으로 넘겼다. CI 통과 여부는 push 후 확인 필요.
