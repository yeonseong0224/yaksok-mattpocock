# 02: 새 약속 만들기와 방장 등록

**What to build:** 홈에서 "새 약속 만들기"를 누르면 초대 링크가 발급된다. 링크로 들어온 사람이 닉네임·PIN으로 처음 등록에 성공하면 방장이 되고, draft 약속이 생기며, 로그인된다. 이미 방장이 있는 링크로 들어온 사람은 "방장이 약속을 설정 중입니다" 화면을 본다.

스펙: `.scratch/first-slice-web-flow/spec.md` (User Stories 1~4, 8~9, 20~25 중 닉네임·PIN 규칙). API: 신규 `POST /links`, MEMBER-API-01, MEMBER-API-02.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] `POST /api/v1/links`는 인증 없이 inviteToken을 발급하고, promise 행은 만들지 않는다
- [x] 링크 조회는 미사용, 설정 중 같은 상태를 돌려준다. GET 요청만으로는 약속이나 방장이 생기지 않는다. 발급 후 3개월이 지난 링크는 410 `LINK_EXPIRED`
- [x] 방장 등록은 약속(draft) 생성, 방장 참여자 생성, 세션 쿠키 발급을 한 트랜잭션으로 처리한다. 쿠키는 `ys_session_{promiseId}`, httpOnly이고 DB에는 토큰 해시만 저장한다
- [x] draft에서 발급한 방장 세션과 쿠키는 발급 시각 + 24시간에 만료된다(MEMBER-06-03)
- [x] 두 명이 동시에 방장 등록을 하면 한 명만 성공하고, 다른 한 명은 설정 중 응답을 받는다
- [x] 닉네임 규칙을 지키지 않으면 422로 거부한다
  - 앞뒤 공백 제거, NFC 정규화, 대소문자 구분
  - 화면에 보이는 글자(grapheme) 기준 1~10자
  - 이모지, 기호, 가운데 공백 허용
  - 제어 문자(Cc)와 서식 문자(Cf)는 거부(ZWJ와 이모지 변형 선택자는 허용)
- [x] PIN은 숫자 4자리만 허용하고 해시로 저장한다
- [ ] 화면: 홈 "새 약속 만들기" → 링크를 발급하고 바로 그 링크 페이지로 이동 → 방장 등록 폼(Figma 05 참여 폼 형식 재사용) / 설정 중 화면. 브라우저에서 수동 확인

## Comments

- 2026-11-09: API·화면 구현(`feat/create-promise-host`). 남은 것: 화면 브라우저 수동 확인.
  - 화면 경로는 `/i/{inviteToken}`.
  - 방장 등록 409는 바로 설정 중 화면으로 보낸다. "이미 등록하셨나요? 로그인" 분기는 로그인 API가 생기는 04로 넘겼다.
  - 새로고침하면 방장도 설정 중 화면을 본다. 본인 확인(`/me`)이 04에서 생긴다.
  - 상태를 바꾸는 요청에 Origin 검사(CSRF)를 넣었다. 이후 POST·PUT·DELETE 라우트도 `rejectForeignOrigin`을 쓴다.
  - PIN 해시는 Node 내장 scrypt(member.md 보안 정보에 기록).
