# STATE API 명세

> 원본: Notion 「API」 › api 명세서 DB (도메인 = STATE)
> 추출일: 2026-10-30
> 공통 규약은 [API_CONVENTIONS.md](../API_CONVENTIONS.md) 참고.
> 상태: `draft` → `collecting` → `closed` → `confirmed`, 그리고 `cancelled`

---

## STATE-API-00 — 작성 가능한 STATE 공통 규약

> 원본 「API 이름」 필드가 `작성 가능한 STATE 공통 규약` 이다. 엔드포인트가 아닌 공통 계약 문서.

ERD 기반 권한·응답·마감 판정·공식 후보 계산 공통 계약.

### 0. 규칙 연결

- 도메인: STATE
- 관련 규칙: STATE-01-01, STATE-01-02, STATE-05-01, STATE-05-03, STATE-08-01
- 근거: 제공한 ERD 설명서 3·4·7·8절 및 위 Notion 규칙
- 권한: 각 API에 정의
- 허용 상태: 각 API에 정의
- 상태 전환: 다섯 상태 enum과 기존 허용 전환을 유지
- 동시성: 동일 약속의 변경은 promises 행을 먼저 잠금. 링크 경로에서는 기존 MEMBER의 promise_links → promises 잠금 순서 유지.
- TBD: 없음. 종료 시각 `24:00`은 API에서 허용하며 DB에는 `daily_end_minute=1440`으로 저장한다
- REVIEW-01~17에서 결정된 STATE 정책은 모두 반영
- 기존 공통 규약: (Notion 멘션 링크 — https://app.notion.com/p/5f675158ccc28286a230812dc3267c89 )

### 1. 기본 정보

- **목적:** 추가 결정 없이 작성 가능한 STATE API의 응답·권한·마감·후보 계산·ERD 매핑을 통일한다.
- **HTTP Method:** 없음 — 공통 계약 문서
- **Endpoint:** 없음 — 외부 호출 대상 아님
- **Authentication Required:** 해당 API의 약속별 세션
- **Content Type:** application/json; charset=utf-8

#### 작성 범위

STATE-API-01~10을 작성했다. 01 조회, 02 모집 시작, 03 모집 중 설정 변경, 04 마감, 05 확정, 06 재조율, 07 취소, 08 본인 탈퇴·자동 승계, 09 MEMBER·TIME 공통 상태 가드, 10 공식 후보 조회로 구성한다. REVIEW-01~17과 기존 MEMBER 계약을 대조해 충돌을 해소했다. 기존 ERD에 없는 변경 이력·후보 캐시·host_participant_id는 임의로 추가하지 않는다. 검토 목록은 (Notion 멘션 링크 — https://app.notion.com/p/3f775158ccc280bba897f5817587c415 )에서 관리한다.

설명서와 Notion 규칙이 충돌한 항목은 검토 DB의 확정 결정과 기존 MEMBER 계약을 적용한다.

### 2. Request 데이터 명세

- promiseId는 UUID이며 권한을 의미하지 않는다.
- 요청자 참여자 ID는 서버 세션에서 얻는다. body의 participantId·isHost·role을 신뢰하지 않는다.
- 모든 시각은 오프셋 포함 ISO 8601, 날짜 경계와 반복 하루 시각은 Asia/Seoul을 사용한다.
- 상세 요청 형식은 각 API의 2절에 정의한다.

### 3. Response 데이터 명세

성공은 래퍼 없는 객체, 오류는 code·message·선택적 details를 반환한다.

```json
{
  "code": "INVALID_PROMISE_STATE",
  "message": "현재 약속 상태에서는 요청할 수 없습니다.",
  "details": {
    "promiseStatus": "collecting",
    "allowedStates": ["closed"]
  }
}
```

#### 미완성 draft 만료

draft는 `promises.created_at+10분`에 만료된다. GET 요청은 만료 여부와 만료 시각만 계산하고 DB를 변경하지 않는다. 기존 방장 또는 새 방장의 쓰기 요청이 만료 draft를 발견하면 promise_link와 관련 행을 정해진 순서로 잠근 뒤 세션 → 방장 참여자 → promise 순서로 명시적으로 삭제하고 promise_link는 보존한다. 만료와 모집 시작이 경쟁하면 잠금 획득 후 서버 시각을 기준으로 먼저 유효하게 처리된 요청을 적용한다.

#### 취소 상태 오류

약속이 `cancelled`이면 모든 일반 STATE API는 세션 인증 결과보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 응답에는 취소 사실 외의 설정·참여자·가능 시간·제출 기록·확정 결과를 포함하지 않는다.

```json
{
  "code": "PROMISE_CANCELLED",
  "message": "취소된 약속입니다."
}
```

#### ERD 대응

| API 데이터                  | DB 또는 계산 기준                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| promiseStatus               | GET 응답은 현재 시각을 반영한 effectiveStatus, 쓰기 응답은 트랜잭션 완료 후 promises.status                                          |
| participantLimit            | promises.participant_limit — 방장 포함 2~30명                                                                                        |
| settings.dateRange          | promises.date_range_start, date_range_end                                                                                            |
| settings.dailyTimeRange     | promises.daily_start_minute, daily_end_minute을 HH:mm으로 변환. 종료에는 24:00 허용                                                  |
| settings.durationMinutes    | promises.duration_minutes                                                                                                            |
| settings.votingDeadlineAt   | promises.voting_deadline_at                                                                                                          |
| 방장 판정                   | 세션 참여자의 participants.role=host 및 status=active                                                                                |
| 본인 제출 여부              | participants.availability_submitted_at — NULL이면 미제출; 기존 MEMBER-API-05가 조회                                                  |
| currentConfirmation.startAt | promises.confirmed_start_at                                                                                                          |
| currentConfirmation.endAt   | confirmed_start_at + duration_minutes                                                                                                |
| 후보 인원·순위              | participant_available_slots와 active 참여자로 계산(제출 상태가 풀린 참여자의 남은 슬롯 포함, 2026-11-11 결정 X-07); 후보 테이블 없음 |

현재 ERD에 없는 host_participant_id·dateRangeLimitMonths·closedAt·closeReason·변경 이력·설정 전용 버전 필드를 기존 컬럼으로 가정하지 않는다. 설정 변경은 STATE-API-01의 settings 전체를 주기적으로 조회해 이전 값과 비교하여 감지한다.

#### 요청 시 상태·마감 판정

1. `promiseId` 형식을 검사하고 약속 존재 여부와 취소 상태를 확인한다.
2. 약속이 `cancelled`이면 세션 인증 결과보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다.
3. 취소 상태가 아니면 세션을 인증하고 요청자의 약속 소속과 `participants.status=active` 여부를 확인한다.
4. GET 요청은 DB 상태를 변경하지 않는다. `status=collecting`이고 현재 시각이 `voting_deadline_at` 이상이면 `effectiveStatus=closed`로 계산하여 응답과 상태 검증에 사용한다.
5. 쓰기 요청은 `promises` 행을 `FOR UPDATE`로 잠근 뒤 취소 상태·참여 상태·권한·마감 시각을 다시 확인한다.
6. 쓰기 요청에서 `status=collecting`이고 잠금 후 `clock_timestamp() >= voting_deadline_at`이면 `promises.status=closed`로 변경한다.
7. 상태 변경 후 해당 API의 허용 상태를 검사하고 요청을 계속 처리하거나 거절한다.
8. 인증 자체가 실패한 요청은 약속의 DB 상태를 변경하지 않는다.
9. 전원 제출은 자동 마감 조건이 아니다. 응답자가 0명 또는 1명이어도 마감 시각에 도달하면 GET에서는 `effectiveStatus=closed`, 쓰기 요청 또는 스케줄러에서는 실제 DB 상태를 `closed`로 처리한다.

조회와 확정 사이에 시간이 지나거나 참여 데이터가 변경될 수 있으므로 확정 요청에서는 후보를 다시 계산·검증한다. 모든 슬롯·참여 변경 경로는 동일한 약속 잠금 규칙을 따라야 한다.

#### 후보 계산 계약

1. participants.status=active인 참여자의 저장된(제출된) 슬롯을 집계한다. 범위 확대로 `availability_submitted_at`이 비워진 참여자도 범위 안에 남은 슬롯은 집계한다(2026-11-11 결정, X-07). 로컬에만 있는 미제출 입력은 서버에 없으므로 집계되지 않는다.
2. 한국 기준 30분 경계의 미래 시각을 후보 시작점으로 한다. 전체 선택 날짜 범위를 대상으로 한다.
3. 약속의 duration_minutes는 30 이상·30의 배수이고 전체 구간이 해당 날짜의 하루 선택 범위 안에 있어야 한다.
4. 해당 구간의 모든 연속 슬롯에 가능한 동일 참여자를 집계한다. 슬롯별 인원수 합이나 최솟값으로 대신하지 않는다.
5. 공통 가능 인원이 2명 이상인 후보만 반환한다. 방장을 한 명으로 포함하지만 방장 참석 자체는 필수 조건이 아니다.
6. 공통 가능 인원 내림차순·시작 시각 오름차순 정렬. 기본 5개 표시, 나머지는 추가 조회한다.
7. 방장은 유효 후보 중 하나를 확정할 수 있다. 1순위나 최초 5개 안에서만 선택하도록 제한하지 않는다.
8. 후보가 없으면 closed를 유지한다. 화면은 STATE-API-06 재조율 또는 STATE-API-07 취소를 안내한다.

#### 상태값

| 상태       | 의미             |
| ---------- | ---------------- |
| draft      | 방장 설정 미완료 |
| collecting | 가능 시간 수집   |
| closed     | 마감·일정 미확정 |
| confirmed  | 일정 확정        |
| cancelled  | 약속 취소        |

participants.status의 active·cancelled는 약속 상태 enum과 다른 값이다. 탈퇴 상태로 left를 추가하지 않는다.

#### effectiveStatus

`effectiveStatus`는 DB 컬럼이 아니라 현재 시각을 반영하여 계산하는 상태다.

- DB `status=collecting`이고 현재 시각이 `voting_deadline_at` 이상이면 `closed`
- 그 외에는 DB status와 동일
- GET 요청은 effectiveStatus만 계산하고 DB status를 변경하지 않음
- 쓰기 요청 또는 마감 스케줄러가 실제 status를 closed로 변경함
- GET 응답의 `promiseStatus`에는 effectiveStatus를 반환함

#### 세션·보존 공통 계약

- collecting 세션은 `voting_deadline_at+7일`까지 유지한다. 조기 마감 시에는 실제 마감 처리 시각+7일로 갱신한다.
- 마감·재조율에 따라 만료 시각을 연장할 때는 `status=active`인 참여자의 현재 유효한 세션만 갱신한다. 이미 만료됐거나 `status=cancelled`인 참여자의 세션은 다시 활성화하지 않는다.
- 세션 만료 후에도 링크 접근 기간이 남아 있고 약속이 cancelled가 아니면 닉네임·PIN으로 재로그인할 수 있다.
- 약속 취소는 `promises.status`와 `promises.cancelled_at`을 변경하며 참여자의 `role`, `status`, `cancelled_at`은 보존한다. 참여자 탈퇴가 완료된 경우에는 해당 참여자의 `status=cancelled`, `cancelled_at=현재 시각`을 기록한다. 단, 후임자가 없는 마지막 방장의 요청은 참여자 탈퇴를 완료하지 않고 약속 취소로 전환한다.
- 세션도 행 삭제 대신 `expires_at`을 현재 시각으로 바꿔 즉시 만료한다.
- cancelled 참여자의 보존된 슬롯·제출 기록은 후보·정원·참석자 집계에서 제외한다.

### 4. 보안 정보

- 기존 MEMBER의 약속별 HttpOnly 세션 쿠키를 사용한다. 쿠키는 `ys_session_{promiseId}`이며 서버는 원문이 아닌 `session_token_hash`로 검증한다. 만료 기준은 저장된 `expires_at`을 사용하며 이 API에서 세션 유지 기간을 새로 정하지 않는다.
- 세션 참여자가 대상 약속에 속하고 `participants.status=active`인지 검사한다. 방장 전용 API는 잠금 후 최신 `participants.role=host`를 확인한다. `host_participant_id`는 현재 ERD에 없으므로 참조하지 않는다.
- HTTPS와 `Cache-Control: no-store`를 사용한다. 변경 요청은 허용 Origin을 검증한다.
- PIN·세션 토큰·다른 사람의 개별 슬롯과 제출 상태를 JSON이나 로그에 노출하지 않는다. 후보 조회는 개별 입력 대신 공통 가능 인원만 반환한다.

---

## STATE-API-01 — 약속 상태와 설정 조회

`GET /api/v1/promises/{promiseId}`

활성 참여자에게 현재 약속 상태·설정·현재 확정 일정을 반환한다. 기한이 지나면 closed 판정을 반영한다.

### 0. 규칙 연결

- 도메인: STATE
- 관련 규칙: STATE-01-01, STATE-05-01, STATE-08-01
- 관련 US: 현재 원본에 연결된 US ID 없음
- 근거: 제공한 시간 조율 ERD 설명서 3.2·3.3·6.1·8.2절 및 해당 Notion 상태 규칙
- 권한: 해당 약속의 active 참여자. draft는 현재 host만
- 허용 상태: draft / collecting / closed / confirmed
- 상태 전환: 없음. 기한이 지났다면 effectiveStatus만 closed로 계산
- 동시성: DB 상태는 변경하지 않으며 일관된 읽기 기준으로 최신 설정과 effectiveStatus를 구성
- TBD: 없음. 취소된 약속은 세션 만료 여부와 관계없이 409 PROMISE_CANCELLED를 반환하며, 인증 없는 초대 링크 조회에서도 취소 안내만 제공한다.
- 기존 공통 규약: (Notion 멘션 링크 — https://app.notion.com/p/5f675158ccc28286a230812dc3267c89 )

### 1. 기본 정보

- **목적:** 활성 참여자에게 현재 약속 상태·설정·현재 확정 일정을 반환한다. 기한이 지나면 closed 판정을 반영한다.
- **HTTP Method:** GET
- **Endpoint:** `/api/v1/promises/{promiseId}`
- **Authentication Required:** 예 — 약속별 세션 쿠키
  > **2026-11-09 (첫 슬라이스 스펙, 티켓 03 구현)**: 세션이 없거나 이 약속의 active 참여자가 아니면 401 대신 `200 { promiseId, promiseStatus }`(상태만)를 돌려준다. 다른 약속의 세션 쿠키는 Path가 달라 전달되지 않으므로, "다른 약속 소속"도 이 경우에 포함된다(쓰기 API에서는 401).
- **Content Type:** application/json; charset=utf-8
- 성공 응답은 기존 MEMBER와 같은 래퍼 없는 JSON이다. 필드·URI·조회 페이지 크기 등 기술 계약은 아래와 같이 정하며 새로운 제품 정책을 추가하지 않는다.

### 요청

#### 헤더

| Name   | Value                    | 필수 |
| ------ | ------------------------ | ---- |
| Cookie | ys_session_{promiseId}=… | 예   |
| Accept | application/json         | 권장 |

#### Path Parameter

| 이름      | 타입         | 설명                                        | 필수 |
| --------- | ------------ | ------------------------------------------- | ---- |
| promiseId | string(UUID) | 초대 링크 조회나 방장 등록으로 받은 약속 ID | 예   |

#### Request Body

본문 없음. 요청자 ID·역할은 세션과 DB에서 확인한다.

### 응답

#### Status Code: 200 OK

| 이름                                          | 타입                        | 설명                                                         |
| --------------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| promiseId                                     | string(UUID)                | 약속 ID                                                      |
| promiseStatus                                 | enum                        | draft / collecting / closed / confirmed                      |
| settings                                      | object                      | draft 미설정 값은 각 필드 NULL                               |
| settings.participantLimit                     | integer 또는 null           | 방장 포함 2~30명 정원                                        |
| settings.dateRange.startDate / endDate        | string(date) 또는 null      | 선택 시작·종료 날짜, 양끝 포함                               |
| settings.dailyTimeRange.startTime / endTime   | string(time) 또는 null      | 분 단위 DB 값을 HH:mm으로 변환. 종료에는 24:00 허용          |
| settings.durationMinutes                      | integer 또는 null           | 30분 배수 소요 시간                                          |
| settings.votingDeadlineAt                     | string(date-time) 또는 null | 응답 마감 시각                                               |
| draftExpiresAt                                | string(date-time) 또는 null | draft이면 created_at+10분, 그 외 null                        |
| draftExpired                                  | boolean                     | GET 기준 draft 만료 여부. GET은 DB를 변경하지 않음           |
| currentConfirmation                           | object 또는 null            | confirmed일 때만 현재 확정 일정                              |
| currentConfirmation.startAt / endAt           | string(date-time)           | 확정 시작 / 시작+현재 소요 시간                              |
| currentConfirmation.availableParticipantCount | integer                     | 현재 active·제출 완료 참여자 중 확정 시간 전체에 가능한 인원 |
| currentConfirmation.hostActionRequired        | boolean                     | 요청자가 host이고 참석 가능 인원이 2명 미만이면 true         |

#### Response Body

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "collecting",
  "draftExpiresAt": null,
  "draftExpired": false,
  "settings": {
    "participantLimit": 8,
    "dateRange": {
      "startDate": "2026-10-20",
      "endDate": "2026-10-31"
    },
    "dailyTimeRange": {
      "startTime": "09:00",
      "endTime": "18:00"
    },
    "durationMinutes": 60,
    "votingDeadlineAt": "2026-10-19T18:00:00+09:00"
  },
  "currentConfirmation": null
}
```

#### 확정 상태 응답 예제

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "confirmed",
  "draftExpiresAt": null,
  "draftExpired": false,
  "settings": {
    "participantLimit": 8,
    "dateRange": {
      "startDate": "2026-10-20",
      "endDate": "2026-10-31"
    },
    "dailyTimeRange": {
      "startTime": "09:00",
      "endTime": "18:00"
    },
    "durationMinutes": 60,
    "votingDeadlineAt": "2026-10-19T18:00:00+09:00"
  },
  "currentConfirmation": {
    "startAt": "2026-10-20T14:00:00+09:00",
    "endAt": "2026-10-20T15:00:00+09:00",
    "availableParticipantCount": 1,
    "hostActionRequired": true
  }
}
```

### 에러

| HTTP 상태 | code                  | 발생 원인                                     | message 예시                             |
| --------- | --------------------- | --------------------------------------------- | ---------------------------------------- |
| 400       | INVALID_REQUEST       | UUID·JSON·쿼리·필수값 형식 오류               | 요청 형식을 확인해 주세요.               |
| 401       | UNAUTHENTICATED       | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | 다시 로그인해 주세요.                    |
| 403       | FORBIDDEN             | 다른 약속 소속 또는 방장 권한 부족            | 이 작업을 수행할 권한이 없습니다.        |
| 404       | PROMISE_NOT_FOUND     | 약속 없음                                     | 약속을 찾을 수 없습니다.                 |
| 409       | PROMISE_CANCELLED     | 약속이 취소됨                                 | 취소된 약속입니다.                       |
| 409       | INVALID_PROMISE_STATE | 이 API에서 허용하지 않는 약속 상태            | 현재 약속 상태에서는 요청할 수 없습니다. |
| 500       | INTERNAL_ERROR        | 서버 오류                                     | 처리 중 오류가 발생했습니다.             |

#### 오류 응답 예제

```json
{
  "code": "UNAUTHENTICATED",
  "message": "다시 로그인해 주세요."
}
```

### 처리 순서와 ERD 대응

1. `promiseId` 형식과 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다.
2. 세션·약속 소속과 active 상태를 확인한다. draft는 현재 host만 허용한다.
3. 이 API는 GET이므로 DB 상태를 변경하지 않는다. draft이면 `draftExpiresAt=created_at+10분`과 현재 시각을 비교해 `draftExpired`를 계산한다. DB `status=collecting`이고 현재 시각이 마감 이상이면 `effectiveStatus=closed`로 계산하고 응답의 `promiseStatus`에 반환한다.
4. promises 설정 컬럼을 settings에 매핑한다. `daily_start_minute`와 `daily_end_minute`은 HH:mm으로 변환하며 종료 값 1440은 24:00으로 반환한다. draft의 미설정 값은 null이다.
5. confirmed이면 `confirmed_start_at`과 계산한 종료 시각을 반환한다. 현재 active·제출 완료 참여자 중 확정 시간 전체에 가능한 인원을 다시 계산해 `availableParticipantCount`에 반환한다.
6. 요청자가 host이고 확정 시간 참석 가능 인원이 2명 미만이면 `hostActionRequired=true`를 반환한다. 확정 상태와 `confirmed_start_at`은 변경하지 않는다.
7. 본인의 role·제출 시각·세션 만료는 기존 MEMBER-API-05로 확인한다. 다른 참여자의 개별 슬롯은 포함하지 않는다.
8. 화면이 열려 있는 동안 이 API를 주기적으로 조회하고 이전 settings 객체와 최신 settings 객체를 비교해 설정 변경을 감지한다. 설정 전용 버전과 과거 변경 이력은 저장하지 않으므로 과거 범위 변경·삭제 슬롯 수를 임의 복원하는 changeNotice 필드는 반환하지 않는다.

### 코드 예제

```javascript
const response = await fetch(`/api/v1/promises/${promiseId}`, {
  method: "GET",
  credentials: "include",
  headers: { Accept: "application/json" },
});
const result = await response.json();
if (!response.ok) {
  // code를 기준으로 로그인·후보 재조회·상태 변경을 안내한다.
  throw result;
}
```

### 보안 정보

- 기존 MEMBER의 약속별 HttpOnly 세션 쿠키를 사용한다. 쿠키는 `ys_session_{promiseId}`이며 서버는 원문이 아닌 `session_token_hash`로 검증한다. 만료 기준은 저장된 `expires_at`을 사용하며 이 API에서 세션 유지 기간을 새로 정하지 않는다.
- 세션 참여자가 대상 약속에 속하고 `participants.status=active`인지 검사한다. 방장 전용 API는 잠금 후 최신 `participants.role=host`를 확인한다. `host_participant_id`는 현재 ERD에 없으므로 참조하지 않는다.
- HTTPS와 `Cache-Control: no-store`를 사용한다. 변경 요청은 허용 Origin을 검증한다.
- PIN·세션 토큰·다른 사람의 개별 슬롯과 제출 상태를 JSON이나 로그에 노출하지 않는다. 후보 조회는 개별 입력 대신 공통 가능 인원만 반환한다.

---

## STATE-API-02 — 설정 완료와 모집 시작

`POST /api/v1/promises/{promiseId}/start`

방장이 필수 설정을 저장하고 draft에서 collecting으로 전환한다.

### 0. 규칙 연결

- 도메인: STATE
- 관련 규칙: STATE-01-02, STATE-03-01, REVIEW-05, REVIEW-07
- 권한: 현재 active host
- 허용 상태: draft
- 상태 전환: draft → collecting
- 동시성: promises 행 잠금 후 권한·상태·DB 시각을 다시 검사하고 설정 저장과 상태 전환을 한 트랜잭션으로 처리
- 기존 공통 규약: (Notion 멘션 링크 — https://app.notion.com/p/3f775158ccc28120bee0e0c2f19e762c )

### 1. 기본 정보

- **목적:** 방장이 필수 설정을 저장하고 가능 시간 수집을 시작한다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/start`
- **Authentication Required:** 예
- **Content Type:** application/json

### 요청

#### Request Body

- `participantLimit`: integer, 필수. 방장 포함 2~30명이며 현재 active 인원 이상
- `dateRange.startDate`, `dateRange.endDate`: YYYY-MM-DD, 필수. 양끝 포함, 최대 90일이므로 `endDate ≤ startDate + 89일`

> ⚠️ 비즈니스 규칙 STATE-03-01은 "오늘부터 3개월"로 규정. 불일치 — 팀 확인 필요.

- `dailyTimeRange.startTime`, `dailyTimeRange.endTime`: HH:mm, 필수. 시작은 00:00~23:30, 종료는 00:30~24:00의 30분 경계이며 시작 분 값은 종료 분 값보다 작아야 함
- `durationMinutes`: integer, 선택(생략하면 120). 30 이상·30분 배수이며 하루 시간 범위(MVP 09:00~24:00, 900분) 이하(2026-11-17 결정)
- `votingDeadlineAt`: 오프셋 포함 ISO 8601, 필수. 잠금 후 DB 시각보다 미래이고 마지막 후보 날짜 00:00(Asia/Seoul)보다 이전
- `dateRangeLimitMonths`는 받지 않는다. 90일은 서버 공통 제한값이다.

> ⚠️ 비즈니스 규칙 STATE-03-01은 "오늘부터 3개월"로 규정. 불일치 — 팀 확인 필요.

```json
{
  "participantLimit": 8,
  "dateRange": { "startDate": "2026-10-20", "endDate": "2026-10-31" },
  "dailyTimeRange": { "startTime": "09:00", "endTime": "18:00" },
  "durationMinutes": 60,
  "votingDeadlineAt": "2026-10-19T18:00:00+09:00"
}
```

### 응답

#### Status Code: 200 OK

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "collecting",
  "settings": {
    "participantLimit": 8,
    "dateRange": { "startDate": "2026-10-20", "endDate": "2026-10-31" },
    "dailyTimeRange": { "startTime": "09:00", "endTime": "18:00" },
    "durationMinutes": 60,
    "votingDeadlineAt": "2026-10-19T18:00:00+09:00"
  }
}
```

### 에러

#### 공통 오류

- `400 INVALID_REQUEST`: UUID·JSON·필드 형식 오류
- `401 UNAUTHENTICATED`: 세션 없음·만료·해시 불일치 또는 참여자 비활성
- `403 FORBIDDEN`: 다른 약속 소속 또는 권한 부족
- `404 PROMISE_NOT_FOUND`: 약속 없음
- `409 PROMISE_CANCELLED`: 약속이 취소됨
- `410 DRAFT_EXPIRED`: draft 생성 후 10분이 지나 만료·정리됨
- `409 INVALID_PROMISE_STATE`: 현재 상태에서 허용되지 않는 요청
- `422 VALIDATION_FAILED`: 값이 비즈니스 규칙을 위반
- `500 INTERNAL_ERROR`: 서버 오류

### 처리 순서

1. promiseId 형식과 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 그다음 세션 소속을 확인하고 promise_link와 promises 행을 정해진 순서로 잠근 뒤 취소 상태·최신 active host·draft 상태를 다시 확인한다. 잠금 후 현재 시각이 created_at+10분 이상이면 세션·방장 참여자·promise를 명시적으로 삭제하고 `410 DRAFT_EXPIRED`를 반환한다.
2. 모든 필수 설정을 검증한다. participantLimit은 2~30명, 날짜 범위는 최대 90일이어야 한다. 일일 시작·종료 문자열은 분 값으로 변환하며 종료 24:00은 1440으로 저장한다. 하나라도 실패하면 아무 값도 저장하지 않는다.

> ⚠️ 비즈니스 규칙 STATE-03-01은 "오늘부터 3개월"로 규정. 불일치 — 팀 확인 필요.

3. 설정과 `status=collecting`을 함께 저장한다.
4. `status=active`인 참여자의 현재 유효한 세션만 `votingDeadlineAt + 7일`로 갱신한다. 이미 만료됐거나 cancelled 참여자에게 속한 세션은 다시 활성화하지 않는다. 각 브라우저 쿠키 만료는 다음 응답에서 같은 기준으로 갱신한다.
5. 이미 collecting인 재요청은 409이며 조회 API로 성공 여부를 확인한다.

### 보안 정보

- 약속별 HttpOnly 세션 쿠키 `ys_session_{promiseId}`를 사용하고 서버는 `session_token_hash`로 검증한다.
- 요청의 `participantId`, `role`, `isHost`를 신뢰하지 않고 세션 참여자의 최신 `status=active`와 `role`을 잠금 후 다시 확인한다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문·다른 참여자의 개별 슬롯을 응답이나 로그에 노출하지 않는다.

---

## STATE-API-03 — 모집 중 설정 변경

`PATCH /api/v1/promises/{promiseId}/settings`

모집 중 설정을 변경하고 범위 변경 영향에 따라 슬롯·제출 상태를 갱신한다.

### 0. 규칙 연결

- 도메인: STATE
- 관련 규칙: STATE-04-01~03, STATE-09-03~05, MEMBER-07-03, TIME-14-03/04, REVIEW-08, REVIEW-14, REVIEW-15
- 권한: 현재 active host
- 허용 상태: collecting이며 마감 전
- 상태 전환: collecting 유지
- 동시성: promises 행 잠금 후 마감·권한을 재검사하고 설정·슬롯 정리·제출 상태 변경을 한 트랜잭션으로 처리

### 1. 기본 정보

- **목적:** 모집 중 허용된 설정(약속 이름, 날짜 범위, 정원, 마감)을 변경한다(재설정). 재설정은 재조율이 아니며 상태는 collecting 그대로다(STATE-01-02, 2026-11-11 결정).
- **HTTP Method:** PATCH
- **Endpoint:** `/api/v1/promises/{promiseId}/settings`
- **Authentication Required:** 예
- **Content Type:** application/json

### 요청

한 필드 이상 필요하며 생략한 값은 유지한다. `dateRange`는 시작·종료를 함께 보낸다.

- `title`: 약속 이름. 1~30자(화면에 보이는 글자 기준), 앞뒤 공백 제거(STATE-03-01)
- `participantLimit`: 2~30명이며 현재 active 인원 이상. 모집 중에도 현재 active 인원까지 감소 허용(2026-11-11 결정, MEMBER-07-03)
- `dateRange`: 오늘(KST)부터, 양 끝 포함 최대 90일(TIME-04-01~03)
- `votingDeadlineAt`: 연장·단축 모두 허용. 잠금 후 서버 시각 + 30분 이상, 날짜 범위 마지막 날 00:00(KST) 미만의 30분 경계(TIME-14-01/02, 2026-11-11 결정 TIME-14-03/04)
- `durationMinutes`: 선택. 모집 시작과 같은 규칙(2026-11-17 결정). 입력·제출 상태는 바뀌지 않고 후보만 다시 계산된다(STATE-04-02)
- `dailyTimeRange`: 받지 않는다. 하루 시간 범위(09:00~24:00)는 MVP 고정이다(2026-11-11 결정, STATE-03-01) 보내도 무시한다. 생략한 마감은 다시 검증하지 않는다(그대로 유지)

```json
{
  "dateRange": { "startDate": "2026-10-20", "endDate": "2026-10-27" },
  "participantLimit": 5
}
```

#### 범위 축소 확인

화면은 범위를 줄일 때 다음 일반 경고를 표시한다. 삭제 개수 미리보기 API는 만들지 않는다.

> 범위를 줄이면 제외되는 날짜·시간의 기존 입력이 삭제됩니다. 변경할까요?

### 응답

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "collecting",
  "settings": {
    "participantLimit": 8,
    "dateRange": { "startDate": "2026-10-20", "endDate": "2026-10-27" },
    "dailyTimeRange": { "startTime": "09:00", "endTime": "18:00" },
    "durationMinutes": 90,
    "votingDeadlineAt": "2026-10-19T18:00:00+09:00"
  },
  "changeImpact": {
    "rangeChanged": true,
    "hasAddedSelectableSlots": false,
    "submissionsReset": false,
    "removedSlotCount": 12,
    "versionChangedParticipantCount": 3,
    "removedSlotParticipantCount": 2,
    "submissionsResetParticipantCount": 0,
    "hasCandidates": true
  }
}
```

- `removedSlotParticipantCount`: 범위 밖 입력이 지워진 인원
- `submissionsResetParticipantCount`: 이번 변경으로 제출 상태가 풀린 인원(이미 미제출이던 사람은 세지 않음)
- `hasCandidates`: 변경 후 후보가 하나라도 있는가. 범위 확대로 제출 상태가 풀린 사람의 남은 선택도 후보 계산에 들어간다(X-07)
- (2026-11-12 구현, 약속 관리 티켓 03) `candidateRecalculationRequired`는 항상 true라 `hasCandidates`로 바꿨다

### 에러

#### 추가 오류

- `422 CAPACITY_BELOW_ACTIVE_COUNT`: 정원이 현재 active 인원보다 작음 (2026-11-11 결정: `CAPACITY_DECREASE_NOT_ALLOWED`를 바꿈. 마감 단축 거부 `DEADLINE_SHORTEN_NOT_ALLOWED`는 없앰)

#### 공통 오류

- `400 INVALID_REQUEST`: UUID·JSON·필드 형식 오류
- `401 UNAUTHENTICATED`: 세션 없음·만료·해시 불일치 또는 참여자 비활성
- `403 FORBIDDEN`: 다른 약속 소속 또는 권한 부족
- `404 PROMISE_NOT_FOUND`: 약속 없음
- `409 PROMISE_CANCELLED`: 약속이 취소됨
- `409 INVALID_PROMISE_STATE`: 현재 상태에서 허용되지 않는 요청
- `422 VALIDATION_FAILED`: 값이 비즈니스 규칙을 위반
- `500 INTERNAL_ERROR`: 서버 오류

### 처리 순서

공통 규약에 따라 promiseId와 약속 존재 여부를 먼저 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 인증 후 promises 행을 잠그면 취소 상태·권한·마감을 다시 확인한다.

1. 잠금 후 마감 시각 이상이면 `collecting→closed`를 먼저 반영하고 변경은 409로 거절한다.
2. 이전 선택 가능 슬롯 집합을 A, 변경 후 집합을 B로 계산한다.
3. 각 참여자의 슬롯은 `기존 슬롯 ∩ B`만 남긴다. 새 슬롯을 자동 선택하지 않는다.
4. `B-A`가 비어 있는 축소만 발생하면 기존 제출 상태를 유지한다.
5. 축소로 실제 슬롯이 삭제된 참여자의 `availability_version`만 1 증가시킨다. 실제 슬롯이 삭제되지 않은 참여자의 버전은 변경하지 않는다.
6. `B-A`가 하나라도 있는 확대·이동이면 모든 active 참여자의 `availability_submitted_at=NULL` 처리와 `availability_version+1`을 수행한다. 제출 시각이 이미 NULL이어도 버전을 증가시킨다.
7. 범위를 바꾸지 않고 이름·정원·마감만 변경한 경우 슬롯·제출 상태·버전을 유지한다. 설정 전용 버전은 두지 않으며 참여자 화면은 STATE-API-01의 settings 전체를 주기적으로 비교한다.
8. 마감을 바꿀 때(연장·단축)는 active 참여자의 현재 유효한 세션만 새 `votingDeadlineAt+7일`로 갱신한다. 이미 만료됐거나 cancelled 참여자의 세션은 다시 활성화하지 않는다.
9. 현재 ERD에는 변경 이력 테이블이 없으므로 과거 changeNotice를 영구 저장하지 않는다. `changeImpact`는 이번 요청의 계산 결과다.

### 보안 정보

- 약속별 HttpOnly 세션 쿠키 `ys_session_{promiseId}`를 사용하고 서버는 `session_token_hash`로 검증한다.
- 요청의 `participantId`, `role`, `isHost`를 신뢰하지 않고 세션 참여자의 최신 `status=active`와 `role`을 잠금 후 다시 확인한다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문·다른 참여자의 개별 슬롯을 응답이나 로그에 노출하지 않는다.

---

## STATE-API-04 — 방장 마감

`POST /api/v1/promises/{promiseId}/close`

> **2026-11-10 결정 (티켓 08 구현)**: ERD에 closedAt이 없어서, 조기 마감하면 `voting_deadline_at`을 실제 마감 처리 시각으로 바꾼다. 그래서 세션 만료와 마감 뒤 다시 로그인한 세션의 기준이 모두 "실제 마감 처리 시각 + 7일"이 된다(MEMBER-06-03). 마감 시각이 이미 지난 collecting이면 마감 시각은 그대로 두고 상태만 closed로 바꾼다.

현재 방장이 수집을 마감한다. 이미 closed인 중복 요청은 데이터를 다시 바꾸지 않고 현재 상태를 반환한다.

### 0. 규칙 연결

- 도메인: STATE
- 관련 규칙: STATE-01-02, STATE-05-01, STATE-05-03
- 관련 US: 현재 원본에 연결된 US ID 없음
- 근거: 제공한 시간 조율 ERD 설명서 6.1·8.2절 및 해당 Notion 상태 규칙
- 권한: 해당 약속의 현재 active host
- 허용 상태: collecting: 마감 수행 / closed: 변경 없이 현재 마감 상태 반환
- 상태 전환: collecting → closed; closed → closed
- 동시성: 약속 잠금 후 최신 host 권한·상태·DB 시각 재검증
- TBD: 없음. 설정 변경·재조율·취소·탈퇴 계약은 STATE-API-03·06·07·08에 반영
- 기존 공통 규약: (Notion 멘션 링크 — https://app.notion.com/p/5f675158ccc28286a230812dc3267c89 )

### 1. 기본 정보

- **목적:** 현재 방장이 수집을 마감한다. 이미 closed인 중복 요청은 데이터를 다시 바꾸지 않고 현재 상태를 반환한다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/close`
- **Authentication Required:** 예 — 약속별 세션 쿠키
- **Content Type:** application/json; charset=utf-8
- 성공 응답은 기존 MEMBER와 같은 래퍼 없는 JSON이다. 필드·URI·조회 페이지 크기 등 기술 계약은 아래와 같이 정하며 새로운 제품 정책을 추가하지 않는다.

### 요청

#### 헤더

| Name   | Value                    | 필수 |
| ------ | ------------------------ | ---- |
| Cookie | ys_session_{promiseId}=… | 예   |
| Accept | application/json         | 권장 |
| Origin | 서비스의 허용 Origin     | 예   |

#### Path Parameter

| 이름      | 타입         | 설명                                        | 필수 |
| --------- | ------------ | ------------------------------------------- | ---- |
| promiseId | string(UUID) | 초대 링크 조회나 방장 등록으로 받은 약속 ID | 예   |

#### Request Body

본문 없음. 요청자 ID·역할은 세션과 DB에서 확인한다.

### 응답

#### Status Code: 200 OK

| 이름          | 타입         | 설명                        |
| ------------- | ------------ | --------------------------- |
| promiseId     | string(UUID) | 약속 ID                     |
| promiseStatus | closed       | 기한 또는 방장 마감 후 상태 |

#### Response Body

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "closed"
}
```

### 에러

| HTTP 상태 | code                  | 발생 원인                                     | message 예시                             |
| --------- | --------------------- | --------------------------------------------- | ---------------------------------------- |
| 400       | INVALID_REQUEST       | UUID·JSON·쿼리·필수값 형식 오류               | 요청 형식을 확인해 주세요.               |
| 401       | UNAUTHENTICATED       | 세션 없음·만료·해시 불일치 또는 참여자 비활성 | 다시 로그인해 주세요.                    |
| 403       | FORBIDDEN             | 다른 약속 소속 또는 방장 권한 부족            | 이 작업을 수행할 권한이 없습니다.        |
| 404       | PROMISE_NOT_FOUND     | 약속 없음                                     | 약속을 찾을 수 없습니다.                 |
| 409       | PROMISE_CANCELLED     | 약속이 취소됨                                 | 취소된 약속입니다.                       |
| 409       | INVALID_PROMISE_STATE | 이 API에서 허용하지 않는 약속 상태            | 현재 약속 상태에서는 요청할 수 없습니다. |
| 500       | INTERNAL_ERROR        | 서버 오류                                     | 처리 중 오류가 발생했습니다.             |

#### 오류 응답 예제

```json
{
  "code": "INVALID_PROMISE_STATE",
  "message": "현재 약속 상태에서는 마감할 수 없습니다.",
  "details": {
    "promiseStatus": "confirmed",
    "allowedStates": ["collecting", "closed"]
  }
}
```

### 처리 순서와 ERD 대응

1. promiseId 형식과 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 그다음 세션 소속을 확인하고 약속 행을 잠근 뒤 취소 상태와 최신 active·host 권한을 다시 확인한다.
2. 이미 closed라면 데이터 변경 없이 200으로 현재 closed 상태를 반환한다. 마감 요청 중복 처리는 새 제품 규칙을 추가하지 않는 기술 계약이다.
3. collecting이라면 잠금 후 서버 시각으로 기한 판정을 수행한다. 이미 기한 도달이면 공통 마감, 기한 전이면 방장 조기 마감으로 closed를 저장한다. 세션 만료 시각을 실제 마감 처리 시각+7일로 변경할 때는 active 참여자의 현재 유효한 세션만 갱신하며, 이미 만료됐거나 cancelled 참여자에게 속한 세션은 다시 활성화하지 않는다.
4. draft·confirmed는 `409 INVALID_PROMISE_STATE`, cancelled는 세션 인증 결과보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 이번 요청에서 확정 시각·참가 입력·제출 기록을 삭제하거나 초기화하지 않는다.
5. 후보는 저장하지 않고 후보 조회 API가 현재 데이터를 계산한다. 현재 ERD에 closedAt·closeReason 컬럼이 없으므로 해당 값을 저장된 마감 이력처럼 응답하지 않는다.
6. 전원 제출 여부·후보 최소 인원은 마감의 선행 조건이 아니다.
7. 화면은 현재 host이면서 collecting일 때만 마감 버튼을 보여주고 요청 중 비활성화한다. 마감 후에는 숨긴다. 재조율로 collecting이 된 뒤 다시 표시한다.
8. 200 중복 처리는 같은 closed 상태에서의 재시도 계약이다. 다른 조율 회차를 가로지르는 지연 요청의 보호 정책은 EXCEPTION 영역에서 별도 다루며 요청 단위 멱등성까지 보장한다고 표현하지 않는다.

### 코드 예제

```javascript
const response = await fetch(`/api/v1/promises/${promiseId}/close`, {
  method: "POST",
  credentials: "include",
  headers: { Accept: "application/json" },
});
const result = await response.json();
if (!response.ok) {
  // code를 기준으로 로그인·후보 재조회·상태 변경을 안내한다.
  throw result;
}
```

### 보안 정보

- 기존 MEMBER의 약속별 HttpOnly 세션 쿠키를 사용한다. 쿠키는 `ys_session_{promiseId}`이며 서버는 원문이 아닌 `session_token_hash`로 검증한다. 만료 기준은 저장된 `expires_at`을 사용하며 이 API에서 세션 유지 기간을 새로 정하지 않는다.
- 세션 참여자가 대상 약속에 속하고 `participants.status=active`인지 검사한다. 방장 전용 API는 잠금 후 최신 `participants.role=host`를 확인한다. `host_participant_id`는 현재 ERD에 없으므로 참조하지 않는다.
- HTTPS와 `Cache-Control: no-store`를 사용한다. 변경 요청은 허용 Origin을 검증한다.
- PIN·세션 토큰·다른 사람의 개별 슬롯과 제출 상태를 JSON이나 로그에 노출하지 않는다. 후보 조회는 개별 입력 대신 공통 가능 인원만 반환한다.

---

## STATE-API-05 — 최종 일정 확정

`POST /api/v1/promises/{promiseId}/confirmation`

> **2026-11-17 결정 (candidate-blocks 03)**: 요청한 `startAt`은 다시 계산한 후보 블록(STATE-API-10) 중 선택 가능한 블록 안의 30분 경계 시작이고, 창 끝(시작 + 약속 길이)이 블록을 넘지 않으며, 그 창 내내 2명 이상 함께 가능해야 한다. 아니면 `409 INVALID_CONFIRMATION_CANDIDATE`와 `details.blocks`(새 후보 블록, 후보 조회와 같은 모양). 아래 2026-11-10 결정의 (1)·(2)를 대신한다.

> **2026-11-10 결정 (첫 슬라이스 스펙·RESULT-11-02·12-02, 티켓 09 구현)**: 아래 원안과 다르게 구현한다. (1) 화면에 표시된 후보(서로 겹치지 않는 최대 5개) 중에서만 확정할 수 있다. 목록 밖의 유효 후보는 허용하지 않는다. (2) 다시 계산한 결과 요청한 시작 시각이 표시 후보가 아니면 `409 INVALID_CONFIRMATION_CANDIDATE`와 `details.candidates`(새 후보 목록, 후보 조회와 같은 모양)를 돌려준다(원안의 422 대신). (3) 기한 전 collecting이면 "먼저 조기 마감" 안내와 함께 `409 INVALID_PROMISE_STATE`. (4) 응답과 STATE-API-01의 `currentConfirmation`에는 참석 가능한 참여자의 닉네임(`participants[]`)도 담는다. 확정 당시 목록은 저장하지 않고 현재 제출값으로 다시 계산한다(RESULT-13-02).

현재 active 방장이 미래 유효 후보 하나를 확정한다. 최신 공통 가능 인원을 다시 검사하고 confirmed_start_at을 저장한다.

### 0. 규칙 연결

- 도메인: STATE
- 관련 규칙: STATE-01-02, STATE-08-01 / ERD 설명서 7.1·7.2
- 관련 US: 현재 원본에 연결된 US ID 없음
- 근거: 제공한 시간 조율 ERD 설명서 3.2·7.1·7.2·8.2절 및 해당 Notion 상태 규칙
- 권한: 해당 약속의 현재 active host
- 허용 상태: closed
- 상태 전환: closed → confirmed; confirmed 직접 교체 불가
- 동시성: 약속 잠금 후 host·closed·최신 후보 유효성 재검증과 확정 저장을 단일 트랜잭션으로 수행
- TBD: 없음. 확정 후 탈퇴는 일정 유지, 일정 변경은 STATE-API-06 재조율을 사용한다.
- 기존 공통 규약: (Notion 멘션 링크 — https://app.notion.com/p/5f675158ccc28286a230812dc3267c89 )

### 1. 기본 정보

- **목적:** 현재 active 방장이 미래 유효 후보 하나를 확정한다. 최신 공통 가능 인원을 다시 검사하고 confirmed_start_at을 저장한다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/confirmation`
- **Authentication Required:** 예 — 약속별 세션 쿠키
- **Content Type:** application/json; charset=utf-8
- 성공 응답은 기존 MEMBER와 같은 래퍼 없는 JSON이다. 필드·URI·조회 페이지 크기 등 기술 계약은 아래와 같이 정하며 새로운 제품 정책을 추가하지 않는다.

### 요청

#### 헤더

| Name         | Value                    | 필수 |
| ------------ | ------------------------ | ---- |
| Cookie       | ys_session_{promiseId}=… | 예   |
| Accept       | application/json         | 권장 |
| Origin       | 서비스의 허용 Origin     | 예   |
| Content-Type | application/json         | 예   |

#### Path Parameter

| 이름      | 타입         | 설명                                        | 필수 |
| --------- | ------------ | ------------------------------------------- | ---- |
| promiseId | string(UUID) | 초대 링크 조회나 방장 등록으로 받은 약속 ID | 예   |

#### Request Body

| 이름    | 타입              | 설명                                                  | 필수 | 기본값 |
| ------- | ----------------- | ----------------------------------------------------- | ---- | ------ |
| startAt | string(date-time) | 오프셋 포함 ISO 8601. 한국 30분 경계의 미래 후보 시작 | 예   | 없음   |

```json
{
  "startAt": "2026-10-20T14:00:00+09:00"
}
```

### 응답

#### Status Code: 200 OK

| 이름                        | 타입              | 설명                                          |
| --------------------------- | ----------------- | --------------------------------------------- |
| promiseId                   | string(UUID)      | 약속 ID                                       |
| promiseStatus               | confirmed         | 확정 완료 상태                                |
| currentConfirmation.startAt | string(date-time) | confirmed_start_at에 저장한 시작              |
| currentConfirmation.endAt   | string(date-time) | 시작+현재 duration_minutes; 별도 DB 컬럼 아님 |

#### Response Body

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "confirmed",
  "currentConfirmation": {
    "startAt": "2026-10-20T14:00:00+09:00",
    "endAt": "2026-10-20T15:00:00+09:00"
  }
}
```

### 에러

| HTTP 상태 | code                           | 발생 원인                                             | message 예시                                                      |
| --------- | ------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------- |
| 400       | INVALID_REQUEST                | UUID·JSON·쿼리·필수값 형식 오류                       | 요청 형식을 확인해 주세요.                                        |
| 401       | UNAUTHENTICATED                | 세션 없음·만료·해시 불일치 또는 참여자 비활성         | 다시 로그인해 주세요.                                             |
| 403       | FORBIDDEN                      | 다른 약속 소속 또는 방장 권한 부족                    | 이 작업을 수행할 권한이 없습니다.                                 |
| 404       | PROMISE_NOT_FOUND              | 약속 없음                                             | 약속을 찾을 수 없습니다.                                          |
| 409       | PROMISE_CANCELLED              | 약속이 취소됨                                         | 취소된 약속입니다.                                                |
| 409       | INVALID_PROMISE_STATE          | 이 API에서 허용하지 않는 약속 상태                    | 현재 약속 상태에서는 요청할 수 없습니다.                          |
| 500       | INTERNAL_ERROR                 | 서버 오류                                             | 처리 중 오류가 발생했습니다.                                      |
| 422       | VALIDATION_FAILED              | startAt 날짜·시간 형식이 유효하지 않음                | 확정 시작 시각을 확인해 주세요.                                   |
| 422       | INVALID_CONFIRMATION_CANDIDATE | 과거 시각·경계 위반·범위 초과·공통 가능 인원 2명 미만 | 후보가 변경되었거나 유효하지 않습니다. 최신 후보를 확인해 주세요. |

#### 오류 응답 예제

```json
{
  "code": "INVALID_PROMISE_STATE",
  "message": "확정된 일정은 직접 변경할 수 없습니다.",
  "details": {
    "promiseStatus": "confirmed",
    "allowedStates": ["closed"]
  }
}
```

### 처리 순서와 ERD 대응

1. startAt과 promiseId 형식을 검증하고 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 그다음 세션 소속을 확인하고 약속 행을 잠근 뒤 취소 상태와 최신 active·host 권한을 다시 확인한다.
2. 이 API는 쓰기 요청이므로 약속 행 잠금 후 마감 시각을 판정한다. DB status가 collecting이고 마감 시각이 지났다면 promises.status=closed를 먼저 저장한 뒤 같은 요청에서 방장 권한과 후보 유효성을 계속 검사할 수 있다. 기한 전 collecting과 이미 confirmed인 요청은 `409 INVALID_PROMISE_STATE`이다.
3. startAt을 절대 시각으로 파싱한다. 클라이언트의 참석 인원·순위·종료·소요 시간은 입력받지 않는다. 같은 절대 시각의 오프셋 표기는 같은 후보로 검사한다.
4. 잠금 후 현재 DB 시각보다 엄격히 미래이고 한국 기준 00분·30분 경계인지 확인한다. 설정 날짜 범위 안에서 전체 duration_minutes가 해당 날의 하루 선택 범위 안에 들어야 한다.
5. active이며 제출 완료인 동일 참여자 중 필요한 모든 연속 30분 슬롯을 선택한 사람이 2명 이상인지 다시 검사한다. 방장은 집계하지만 방장 참석은 필수 조건이 아니다.
6. 상위 5개에 없더라도 전체 유효 후보이면 허용한다. 유효하지 않거나 시간이 이미 지났으면 422 INVALID_CONFIRMATION_CANDIDATE로 거부하고 최신 후보 재조회를 안내한다.
7. promises.confirmed_start_at=startAt과 status=confirmed를 함께 저장한다. endAt은 현재 duration_minutes로 계산한다. 제출 상태·참가 슬롯을 초기화하지 않는다.
8. 응답 유실 시 STATE-API-01로 확정 결과를 확인한다. 이미 confirmed인 재요청은 409로 일관되게 처리하며 일정 교체를 실행하지 않는다. 일정 변경은 STATE-API-06으로 재조율한 뒤 다시 확정한다.

### 코드 예제

```javascript
const response = await fetch(`/api/v1/promises/${promiseId}/confirmation`, {
  method: "POST",
  credentials: "include",
  headers: { Accept: "application/json", "Content-Type": "application/json" },
  body: JSON.stringify({ startAt }),
});
const result = await response.json();
if (!response.ok) {
  // code를 기준으로 로그인·후보 재조회·상태 변경을 안내한다.
  throw result;
}
```

### 보안 정보

- 기존 MEMBER의 약속별 HttpOnly 세션 쿠키를 사용한다. 쿠키는 `ys_session_{promiseId}`이며 서버는 원문이 아닌 `session_token_hash`로 검증한다. 만료 기준은 저장된 `expires_at`을 사용하며 이 API에서 세션 유지 기간을 새로 정하지 않는다.
- 세션 참여자가 대상 약속에 속하고 `participants.status=active`인지 검사한다. 방장 전용 API는 잠금 후 최신 `participants.role=host`를 확인한다. `host_participant_id`는 현재 ERD에 없으므로 참조하지 않는다.
- HTTPS와 `Cache-Control: no-store`를 사용한다. 변경 요청은 허용 Origin을 검증한다.
- PIN·세션 토큰·다른 사람의 개별 슬롯과 제출 상태를 JSON이나 로그에 노출하지 않는다. 후보 조회는 개별 입력 대신 공통 가능 인원만 반환한다.

---

## STATE-API-06 — 재조율 시작

`POST /api/v1/promises/{promiseId}/reopen`

closed·confirmed 약속을 collecting으로 다시 열고 새 마감과 선택 설정을 적용한다.

### 0. 규칙 연결

- 도메인: STATE
- 관련 규칙: STATE-01-01~02, STATE-06-01, STATE-08-01, STATE-09-01~05, REVIEW-04, REVIEW-14, REVIEW-15
- 권한: 현재 active host
- 허용 상태: closed / confirmed (2026-11-11 결정, STATE-09-01). draft·collecting은 409 `INVALID_PROMISE_STATE`
- 상태 전환: closed / confirmed → collecting
- 동시성: promises 행 잠금 후 모든 설정·슬롯·제출·확정값 변경을 한 트랜잭션으로 처리

### 1. 기본 정보

- **목적:** 마감되거나 확정된 약속을 다시 열어 응답을 받는다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/reopen`
- **Authentication Required:** 예
- **Content Type:** application/json

### 요청

- `votingDeadlineAt`: 필수. 현재 시각 + 30분 이상이며 적용 후 날짜 범위 마지막 날 00:00(KST)보다 앞 — 재설정·모집 시작과 같은 규칙(TIME-14-01/02, 2026-11-11 결정)
- `title`: 선택. 생략 시 유지. 1~30자(2026-11-12 결정)
- `participantLimit`: 선택. 현재 active 인원 이상이면서 2~30명 범위에서 증가·감소 가능
- `dateRange`: 선택. 생략 시 유지. 오늘(KST)부터, 양 끝 포함 최대 90일
- `durationMinutes`: 선택. 모집 시작과 같은 규칙(2026-11-17 결정)
- `dailyTimeRange`: 받지 않는다. MVP 고정(2026-11-11 결정, STATE-03-01)

```json
{
  "votingDeadlineAt": "2026-10-21T18:00:00+09:00",
  "participantLimit": 10,
  "dateRange": { "startDate": "2026-10-20", "endDate": "2026-11-07" }
}
```

### 응답

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "collecting",
  "settings": { "...": "STATE-API-03 응답의 settings와 같은 모양" },
  "currentConfirmation": null,
  "changeImpact": {
    "rangeChanged": true,
    "hasAddedSelectableSlots": true,
    "submissionsReset": true,
    "removedSlotCount": 0,
    "removedSlotParticipantCount": 0,
    "versionChangedParticipantCount": 5,
    "submissionsResetParticipantCount": 4,
    "hasCandidates": true,
    "confirmationCleared": true
  }
}
```

- (2026-11-12 구현, 약속 관리 티켓 04) `changeImpact`는 STATE-API-03과 같은 필드에 `confirmationCleared`를 더한 것이다. 응답에 `settings`를 함께 준다.
- `title`도 선택으로 받는다(2026-11-12 결정: 재조율 폼도 재설정처럼 약속 이름을 바꿀 수 있다). 마감 시각이 지났지만 아직 DB가 collecting인 약속은 closed로 보고 다시 연다(ADR-0001).

### 에러

#### 추가 오류

- `422 CAPACITY_BELOW_ACTIVE_COUNT`: 정원이 현재 active 인원보다 작음

#### 공통 오류

- `400 INVALID_REQUEST`: UUID·JSON·필드 형식 오류
- `401 UNAUTHENTICATED`: 세션 없음·만료·해시 불일치 또는 참여자 비활성
- `403 FORBIDDEN`: 다른 약속 소속 또는 권한 부족
- `404 PROMISE_NOT_FOUND`: 약속 없음
- `409 PROMISE_CANCELLED`: 약속이 취소됨
- `409 INVALID_PROMISE_STATE`: 현재 상태에서 허용되지 않는 요청
- `422 VALIDATION_FAILED`: 값이 비즈니스 규칙을 위반
- `500 INTERNAL_ERROR`: 서버 오류

### 처리 순서

1. promiseId 형식과 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 그다음 세션을 인증하고 promises 행을 잠근 뒤 취소 상태·최신 active host·closed 또는 confirmed 상태를 다시 확인한다.
2. 새 설정과 `votingDeadlineAt`(현재+30분 이상, 마지막 날 00:00 KST 미만)을 검증한다.
3. confirmed에서 재조율하는 경우 `confirmed_start_at=NULL`로 변경한다. 현재 ERD에는 과거 확정 이력 저장 구조가 없다.
4. 이전 선택 가능 슬롯 집합 A와 변경 후 집합 B를 계산하고, 새 범위 밖의 기존 슬롯만 삭제한다. 범위 안 슬롯은 유지한다.
5. `B-A`가 비어 있는 축소만 발생하면 제출 상태를 유지한다. 축소로 실제 슬롯이 삭제된 참여자의 `availability_version`만 1 증가시키며, 실제 슬롯이 삭제되지 않은 참여자의 버전은 변경하지 않는다.
6. `B-A`가 하나라도 있는 확대·이동이면 모든 active 참여자의 `availability_submitted_at=NULL` 처리와 `availability_version+1`을 수행한다. 제출 시각이 이미 NULL이어도 버전을 증가시킨다.
7. 범위를 변경하지 않은 경우 슬롯·제출 상태·버전을 유지한다. 설정 전용 버전은 두지 않으며 참여자 화면은 STATE-API-01의 settings 전체를 주기적으로 비교한다.
8. `status=collecting`과 새 마감을 저장한다. 빈자리가 있으면 정원을 바꾸지 않아도 신규 참여를 허용한다.
9. active 참여자의 현재 유효한 세션만 새 `votingDeadlineAt+7일`로 갱신한다. 이미 만료됐거나 cancelled 참여자에게 속한 세션은 다시 활성화하지 않는다.

### 보안 정보

- 약속별 HttpOnly 세션 쿠키 `ys_session_{promiseId}`를 사용하고 서버는 `session_token_hash`로 검증한다.
- 요청의 `participantId`, `role`, `isHost`를 신뢰하지 않고 세션 참여자의 최신 `status=active`와 `role`을 잠금 후 다시 확인한다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문·다른 참여자의 개별 슬롯을 응답이나 로그에 노출하지 않는다.

---

## STATE-API-07 — 약속 취소

`POST /api/v1/promises/{promiseId}/cancel`

방장이 약속을 cancelled로 전환하고 데이터는 보존한 채 모든 세션을 즉시 만료한다.

### 0. 규칙 연결

- 도메인: STATE
- 관련 규칙: STATE-01-02, STATE-10-01~03, REVIEW-03, REVIEW-16
- 권한: 현재 active host
- 허용 상태: collecting / closed / confirmed (2026-11-11 결정, STATE-10-02). draft는 409 `INVALID_PROMISE_STATE`이며, 초안은 방장 나가기(STATE-API-08)로 삭제한다
- 상태 전환: 취소 전 상태 → cancelled
- 동시성: promises 행 잠금 후 상태 변경과 전체 세션 만료를 한 트랜잭션으로 처리

### 1. 기본 정보

- **목적:** 방장이 약속을 복원 불가능하게 취소한다. DB 데이터는 물리 삭제하지 않는다.
- **HTTP Method:** POST
- **Endpoint:** `/api/v1/promises/{promiseId}/cancel`
- **Authentication Required:** 예
- **Request Body:** 없음

### 요청

- Cookie, Accept, Origin 헤더를 사용한다.
- promiseId는 경로에서 받으며 요청자 ID와 role은 세션에서 확인한다.

### 응답

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "cancelled",
  "cancelledAt": "2026-10-27T20:30:00+09:00",
  "message": "취소된 약속입니다."
}
```

### 에러

#### 공통 오류

- `400 INVALID_REQUEST`: UUID·JSON·필드 형식 오류
- `401 UNAUTHENTICATED`: 세션 없음·만료·해시 불일치 또는 참여자 비활성
- `403 FORBIDDEN`: 다른 약속 소속 또는 권한 부족
- `404 PROMISE_NOT_FOUND`: 약속 없음
- `409 PROMISE_CANCELLED`: 약속이 이미 취소됨
- `409 INVALID_PROMISE_STATE`: 현재 상태에서 허용되지 않는 요청
- `422 VALIDATION_FAILED`: 값이 비즈니스 규칙을 위반
- `500 INTERNAL_ERROR`: 서버 오류

### 처리 순서와 데이터 보존

1. promiseId 형식과 약속 존재 여부를 확인한다. 약속이 이미 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다. 그다음 세션 소속을 확인하고 promises 행을 잠근 뒤 취소 상태·최신 active host·허용 상태를 다시 확인한다.
2. `promises.status=cancelled`, `promises.cancelled_at=clock_timestamp()`로 함께 변경한다.
3. 설정과 모든 참여자 데이터를 보존한다. 참여자의 `role`, `status`, `cancelled_at`, 닉네임, PIN 해시, 가능 슬롯, 제출 시각, `availability_version`을 변경하지 않으며 `confirmed_start_at`도 보존한다. MVP에서는 취소 데이터를 자동 삭제하지 않는다. 후보는 저장 테이블이 없으므로 삭제 대상이 아니다.
4. 약속 취소는 참여자 탈퇴와 다르다. 약속이 `cancelled`로 변경되더라도 각 참여자를 `cancelled`로 바꾸거나 방장을 `member`로 내리지 않는다. 참여자 상태는 보존하고 모든 세션만 즉시 만료한다.
5. 해당 약속의 모든 세션 행은 삭제하지 않고 `expires_at=clock_timestamp()`로 갱신해 즉시 사용할 수 없게 한다. 응답 쿠키도 Max-Age=0으로 만료한다.
6. 기존 초대 링크는 유지하며 인증 없이 `cancelled`와 취소 안내만 반환한다. 상세 설정·입력·결과는 노출하지 않는다.
7. 취소 후 재로그인·재조율·복원은 허용하지 않는다.
8. 약속 취소 요청이 성공한 최초 요청에는 200 OK를 반환한다. 취소 트랜잭션 완료 후 동일 API를 포함한 일반 API를 다시 호출하면 세션 만료 여부와 관계없이 `409 PROMISE_CANCELLED`를 반환한다.

### 보안 정보

- 약속별 HttpOnly 세션 쿠키 `ys_session_{promiseId}`를 사용하고 서버는 `session_token_hash`로 검증한다.
- 요청의 `participantId`, `role`, `isHost`를 신뢰하지 않고 세션 참여자의 최신 `status=active`와 `role`을 잠금 후 다시 확인한다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문·다른 참여자의 개별 슬롯을 응답이나 로그에 노출하지 않는다.

---

## STATE-API-08 — 본인 탈퇴와 자동 승계

`DELETE /api/v1/promises/{promiseId}/participants/me`

본인 탈퇴를 처리하고 방장이면 기존 MEMBER 규칙에 따라 자동 승계한다.

### 0. 규칙 연결

- 도메인: STATE / MEMBER 연동
- 관련 규칙: STATE-06-01~02, MEMBER-10-01·03, MEMBER-12-01·03·04, REVIEW-11~13·17
- 권한: 해당 약속의 active 참여자
- 허용 상태: collecting / closed / confirmed, 그리고 draft의 방장(초안 삭제). cancelled는 거부 (2026-11-11 결정, MEMBER-10-01)
- 상태 전환: 일반 참여자와 후임자가 있는 방장의 탈퇴는 참여자 상태를 cancelled로 변경한다. 후임자가 없는 마지막 방장의 탈퇴 요청은 참여자 탈퇴를 완료하지 않고 약속 cancelled로 전환한다.
- 동시성: promises 행 잠금 후 후임자 존재 여부, 방장 자동 승계, 조건부 참여자 상태 변경, 약속 취소 및 세션 만료를 한 트랜잭션으로 처리

### 1. 기본 정보

- **목적:** 본인이 약속에서 탈퇴한다. 마감·확정 후에도 허용하며 데이터를 물리 삭제하지 않는다. 단, 후임자가 없는 마지막 방장의 요청은 방장 참여자 상태를 유지한 채 약속 전체 취소로 전환한다.
- **HTTP Method:** DELETE
- **Endpoint:** `/api/v1/promises/{promiseId}/participants/me`
- **Authentication Required:** 예

### 요청

본문과 participantId를 받지 않는다. 세션 참여자 본인만 처리한다.

### 응답

일반 참여자 또는 후임자가 있는 방장의 탈퇴가 완료된 경우:

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "confirmed",
  "participantStatus": "cancelled",
  "participantCancelledAt": "2026-10-27T20:30:00+09:00",
  "hostTransferred": false,
  "newHostParticipantId": null,
  "promiseCancelledAt": null
}
```

후임자가 없는 마지막 방장의 요청이 약속 취소로 전환된 경우:

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "cancelled",
  "participantStatus": "active",
  "participantCancelledAt": null,
  "hostTransferred": false,
  "newHostParticipantId": null,
  "promiseCancelledAt": "2026-10-27T20:30:00+09:00"
}
```

두 번째 응답의 `participantStatus=active`는 탈퇴 후에도 활동을 허용한다는 뜻이 아니다. 약속 취소 정책에 따라 참여자 원본 상태를 보존한 결과이며, 모든 세션이 즉시 만료되고 cancelled 약속의 후속 요청은 차단된다.

`draft`에서 방장이 탈퇴해 초안이 폐기된 경우:

```json
{
  "result": "draft_discarded",
  "promiseId": null
}
```

약속과 방장 기록이 물리 삭제되었으므로 기존 promiseId는 더 이상 유효하지 않다. 클라이언트는 쿠키가 제거된 상태로 링크 첫 화면(MEMBER-API-01)으로 돌아가며, 링크는 다른 사용자가 다시 방장 등록할 수 있다.

### 에러

#### 공통 오류

- `400 INVALID_REQUEST`: UUID·JSON·필드 형식 오류
- `401 UNAUTHENTICATED`: 세션 없음·만료·해시 불일치 또는 참여자 비활성
- `403 FORBIDDEN`: 다른 약속 소속 또는 권한 부족
- `404 PROMISE_NOT_FOUND`: 약속 없음
- `409 PROMISE_CANCELLED`: 약속이 취소됨
- `409 INVALID_PROMISE_STATE`: 현재 상태에서 허용되지 않는 요청
- `422 VALIDATION_FAILED`: 값이 비즈니스 규칙을 위반
- `500 INTERNAL_ERROR`: 서버 오류

### 처리 순서

1. `promiseId` 형식과 약속 존재 여부를 확인한다. 요청이 시작될 때 약속이 이미 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다.
2. 세션에서 요청자를 확인하고 promises 행을 잠근 뒤 요청자가 `status=active`인지와 최신 role을 다시 확인한다.
3. 약속이 `draft`면 초안 폐기로 처리한다. `promise_link_id`를 잠금 없이 읽고 promise_links → promises 순서로 다시 잠근 뒤 여전히 `draft`인지 확인한다. 세션 → 방장 참여자 → promise 순서로 물리 삭제하고 쿠키를 제거한다. 링크는 미사용 상태로 남는다. 이후 4번 이하는 실행하지 않는다.
4. 요청자가 일반 참여자이면 `participants.status=cancelled`, `participants.cancelled_at=clock_timestamp()`로 변경한다. 닉네임·PIN 해시·가능 슬롯·제출 시각·`availability_version`은 보존하고 관련 세션을 즉시 만료한다.
5. 요청자가 방장이면 본인을 제외한 active 참여자 중 `created_at ASC, id ASC` 첫 사람을 후임 방장으로 정한다. 제출 여부는 승계 조건으로 사용하지 않는다.
6. 후임자가 있으면 같은 트랜잭션에서 기존 방장을 `role=member, status=cancelled, cancelled_at=clock_timestamp()`, 새 방장을 `role=host, status=active`로 변경하고 기존 방장의 모든 세션을 즉시 만료한다. 하나라도 실패하면 전체 롤백한다.
7. 후임자가 없으면 마지막 방장의 참여자 탈퇴를 완료하지 않고 약속 전체 취소로 전환한다. 기존 방장의 `role=host`, `status=active`, `cancelled_at=NULL`은 변경하지 않고 약속만 `status=cancelled, cancelled_at=clock_timestamp()`로 변경한다. 약속 취소 정책에 따라 해당 약속의 모든 참여자 세션을 즉시 만료하고 응답 쿠키를 제거한다.
8. 7번은 이미 cancelled인 약속에서 탈퇴를 허용하는 규칙이 아니다. 요청 시작 시점에는 약속이 취소되지 않았고, 잠금 후 후임자가 없다는 사실을 확인한 결과 탈퇴 요청이 약속 취소로 원자적으로 전환되는 예외다.
9. 참여자 탈퇴가 완료된 4번·6번에서는 탈퇴자를 정원·후보·가능 인원·참석자 등 모든 active 집계에서 제외한다. 7번에서는 약속 자체가 cancelled이므로 이후 집계·조회·수정 기능을 제공하지 않는다.
10. closed에서 4번·6번의 탈퇴가 완료되면 약속 상태를 유지하고 다음 공식 후보 조회에서 최신 active 참여자를 기준으로 다시 계산한다.
11. confirmed에서 4번·6번의 탈퇴가 완료되면 약속 상태와 `confirmed_start_at`을 유지하고 참석자 명단을 최신 active 참여자 기준으로 갱신한다.
12. 확정 시간 참석 가능 인원이 2명 미만이어도 자동 확정 해제·자동 취소하지 않는다. STATE-API-01의 `hostActionRequired`로 방장에게 재조율·취소를 안내한다.

> 2026-11-11 결정(X-11): 처리 순서 안의 번호 참조를 실제 항목(4·6·7번)에 맞게 고쳤다.

### 보안 정보

- 약속별 HttpOnly 세션 쿠키 `ys_session_{promiseId}`를 사용하고 서버는 `session_token_hash`로 검증한다.
- 요청의 `participantId`, `role`, `isHost`를 신뢰하지 않고 세션 참여자의 최신 `status=active`와 `role`을 잠금 후 다시 확인한다.
- 변경 요청은 HTTPS와 허용 Origin 검증을 사용하고 응답은 `Cache-Control: no-store`로 제공한다.
- PIN·세션 원문·다른 참여자의 개별 슬롯을 응답이나 로그에 노출하지 않는다.

---

## STATE-API-09 — MEMBER·TIME 상태 제한 연동

> 원본 DB의 `endpoint` 필드는 `내부 공통 가드`, `설명`은 "참여·탈퇴·내보내기·입력·제출 API에 공통 상태·마감·재조율 제한을 적용한다."
>
> 2026-11-11 결정(X-10): 원본 본문은 STATE-API-08(본인 탈퇴와 자동 승계)의 복사본이었으므로 지웠다. 엔드포인트가 아닌 공통 가드이며 별도 명세는 두지 않는다. 공통 상태·마감 판정은 STATE-API-00의 「취소 상태 오류」「요청 시 상태·마감 판정」「effectiveStatus」를, 각 API의 허용 상태는 해당 API의 0절을 따른다. 본인 탈퇴는 STATE-API-08, 참여자 내보내기는 MEMBER-API-08이다.

---

## STATE-API-10 — 공식 시간 후보 조회

> **2026-11-17 결정 (candidate-blocks 02)**: 응답은 `candidates[]` 대신 `durationMinutes`와 `blocks[]`다. 블록 하나는 `{ date, startAt, endAt, selectable, best }`이고, `best`는 최적 창(`startAt`, `endAt`, `availableParticipantCount`, `participants[]`) 또는 `null`(선택할 수 없는 블록)이다. 규칙은 RESULT.md의 2026-11-17 결정을 따른다. 아래 원안의 `candidates[]` 표는 이 결정 전 모양이다.

`GET /api/v1/promises/{promiseId}/candidates`

> **2026-11-10 결정 (첫 슬라이스 스펙, 티켓 08 구현)**: 아래 원안과 다르게 구현한다. (1) 모집 중(collecting)에도 현재 제출값 기준의 후보를 돌려준다(RESULT-09-01). (2) 후보마다 참석 가능한 참여자의 닉네임을 `participants[]`로 돌려준다(RESULT-10-01). (3) 서로 겹치지 않는 최대 5개만 계산하므로(RESULT-07-02) `limit`·`offset`·`total`·`hasMore`·`nextOffset`은 없다. 로그인한 active 참여자만 볼 수 있다.

마감된 약속의 전체 범위에서 미래 유효 후보를 공통 가능 인원·시작 시각 순으로 조회한다.

### 0. 규칙 연결

- 도메인: STATE
- 관련 규칙: STATE-05-01 / ERD 설명서 7.1~7.3 후보 계산 조건
- 관련 US: 현재 원본에 연결된 US ID 없음
- 근거: 제공한 시간 조율 ERD 설명서 7.1~7.3·8.2절 및 해당 Notion 상태 규칙
- 권한: 해당 약속의 active 참여자
- 허용 상태: closed
- 상태 전환: 없음. 기한 도달 collecting은 effectiveStatus=closed로 계산하며 기한 전 collecting은 409
- 동시성: DB 상태를 변경하지 않고 일관된 읽기 기준과 서버 시각 1회로 후보 계산
- TBD: 없음. 탈퇴 참여자는 status=cancelled로 집계에서 제외하며 확정 후 탈퇴는 기존 확정 일정을 바꾸지 않는다.
- 기존 공통 규약: (Notion 멘션 링크 — https://app.notion.com/p/5f675158ccc28286a230812dc3267c89 )

### 1. 기본 정보

- **목적:** 마감된 약속의 전체 범위에서 미래 유효 후보를 공통 가능 인원·시작 시각 순으로 조회한다.
- **HTTP Method:** GET
- **Endpoint:** `/api/v1/promises/{promiseId}/candidates`
- **Authentication Required:** 예 — 약속별 세션 쿠키
- **Content Type:** application/json; charset=utf-8
- 성공 응답은 기존 MEMBER와 같은 래퍼 없는 JSON이다. 필드·URI·조회 페이지 크기 등 기술 계약은 아래와 같이 정하며 새로운 제품 정책을 추가하지 않는다.

### 요청

#### 헤더

| Name   | Value                    | 필수 |
| ------ | ------------------------ | ---- |
| Cookie | ys_session_{promiseId}=… | 예   |
| Accept | application/json         | 권장 |

#### Path Parameter

| 이름      | 타입         | 설명                                        | 필수 |
| --------- | ------------ | ------------------------------------------- | ---- |
| promiseId | string(UUID) | 초대 링크 조회나 방장 등록으로 받은 약속 ID | 예   |

#### Query Parameter

| 이름   | 타입    | 설명                     | 필수   | 기본값 |
| ------ | ------- | ------------------------ | ------ | ------ |
| limit  | integer | 1~5. 한 번에 반환할 개수 | 아니오 | 5      |
| offset | integer | 0 이상의 결과 시작 위치  | 아니오 | 0      |

#### Request Body

본문 없음. 요청자 ID·역할은 세션과 DB에서 확인한다.

### 응답

#### Status Code: 200 OK

| 이름                                   | 타입              | 설명                                                                        |
| -------------------------------------- | ----------------- | --------------------------------------------------------------------------- |
| promiseId                              | string(UUID)      | 약속 ID                                                                     |
| promiseStatus                          | closed            | 현재 시각을 반영해 계산한 effectiveStatus. DB status는 collecting일 수 있음 |
| calculatedAt                           | string(date-time) | 이번 후보 계산의 서버 기준 시각                                             |
| limit / offset                         | integer           | 적용한 페이지 요청                                                          |
| total                                  | integer           | 이 시각의 전체 유효 후보 개수                                               |
| hasMore                                | boolean           | 추가 후보 여부                                                              |
| nextOffset                             | integer 또는 null | 추가 요청 위치; 없으면 null                                                 |
| candidates                             | array             | 이번 페이지의 후보                                                          |
| candidates[].startAt / endAt           | string(date-time) | 미래 시작 / 시작+소요 시간                                                  |
| candidates[].availableParticipantCount | integer           | 전체 연속 구간 공통 가능 인원, 2 이상                                       |

#### Response Body

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "closed",
  "calculatedAt": "2026-10-19T18:01:00+09:00",
  "limit": 5,
  "offset": 0,
  "total": 1,
  "hasMore": false,
  "nextOffset": null,
  "candidates": [
    {
      "startAt": "2026-10-20T14:00:00+09:00",
      "endAt": "2026-10-20T15:00:00+09:00",
      "availableParticipantCount": 3
    }
  ]
}
```

#### 후보 없음: 오류가 아닌 200

```json
{
  "promiseId": "7c1b2f40-808a-4f31-8a27-d849330dd123",
  "promiseStatus": "closed",
  "calculatedAt": "2026-10-19T18:01:00+09:00",
  "limit": 5,
  "offset": 0,
  "total": 0,
  "hasMore": false,
  "nextOffset": null,
  "candidates": []
}
```

### 에러

| HTTP 상태 | code                  | 발생 원인                                        | message 예시                             |
| --------- | --------------------- | ------------------------------------------------ | ---------------------------------------- |
| 400       | INVALID_REQUEST       | UUID·JSON·쿼리·필수값 형식 오류                  | 요청 형식을 확인해 주세요.               |
| 401       | UNAUTHENTICATED       | 세션 없음·만료·해시 불일치 또는 참여자 비활성    | 다시 로그인해 주세요.                    |
| 403       | FORBIDDEN             | 다른 약속 소속 또는 방장 권한 부족               | 이 작업을 수행할 권한이 없습니다.        |
| 404       | PROMISE_NOT_FOUND     | 약속 없음                                        | 약속을 찾을 수 없습니다.                 |
| 409       | PROMISE_CANCELLED     | 약속이 취소됨                                    | 취소된 약속입니다.                       |
| 409       | INVALID_PROMISE_STATE | 이 API에서 허용하지 않는 약속 상태               | 현재 약속 상태에서는 요청할 수 없습니다. |
| 500       | INTERNAL_ERROR        | 서버 오류                                        | 처리 중 오류가 발생했습니다.             |
| 422       | VALIDATION_FAILED     | limit이 1~5가 아니거나 offset이 음수·정수가 아님 | 후보 조회 범위를 확인해 주세요.          |

#### 오류 응답 예제

```json
{
  "code": "INVALID_PROMISE_STATE",
  "message": "응답 마감 후 후보를 조회할 수 있습니다.",
  "details": {
    "promiseStatus": "collecting",
    "allowedStates": ["closed"]
  }
}
```

### 처리 순서와 ERD 대응

1. limit·offset과 promiseId 형식을 검증하고 약속 존재 여부를 확인한다. 약속이 cancelled이면 세션 인증보다 우선하여 `409 PROMISE_CANCELLED`를 반환한다.
2. 세션과 active 참여 상태를 확인한다. 이 API는 GET이므로 DB status를 변경하거나 약속 행을 쓰기 잠금하지 않는다.
3. DB `status=collecting`이고 현재 시각이 `voting_deadline_at` 이상이면 `effectiveStatus=closed`로 계산한다. 응답의 `promiseStatus`에는 effectiveStatus를 반환한다.
4. effectiveStatus가 closed가 아니면 409를 반환한다. confirmed에서는 확정 일정 조회를 사용한다.
5. 공통 후보 계산 계약에 따라 전체 날짜 범위의 모든 유효 후보를 일관된 읽기 기준으로 계산한다. 화면에 보이는 주로 제한하지 않는다.
6. active이고 제출 완료인 동일 참여자들의 모든 연속 슬롯 참석을 집계한다. 2명 이상 후보만 포함하고 인원 내림차순·시작 오름차순으로 정렬한다.
7. 해당 계산 시각의 후보 전체 개수를 total로 반환하고 offset부터 limit개를 반환한다. offset이 전체 개수 이상이면 빈 배열·hasMore=false·nextOffset=null이다.
8. 현재 ERD에 추천 결과 테이블이 없으므로 후보 ID나 영구 순위를 만들지 않는다. 후보 식별은 startAt이며 유효성은 확정 요청 때 다시 계산한다.
9. 페이지 요청 사이에 시간·참여 데이터가 바뀌면 total·순서가 달라질 수 있다. calculatedAt을 반환하고 정해진 결과 스냅샷을 보장하지 않는다.
10. 공식 후보 조회 응답에는 참여자별 슬롯·제출 여부·닉네임 목록을 포함하지 않는다.

### 코드 예제

```javascript
const response = await fetch(`/api/v1/promises/${promiseId}/candidates?limit=5&offset=0`, {
  method: "GET",
  credentials: "include",
  headers: { Accept: "application/json" },
});
const result = await response.json();
if (!response.ok) {
  // code를 기준으로 로그인·후보 재조회·상태 변경을 안내한다.
  throw result;
}
```

### 보안 정보

- 기존 MEMBER의 약속별 HttpOnly 세션 쿠키를 사용한다. 쿠키는 `ys_session_{promiseId}`이며 서버는 원문이 아닌 `session_token_hash`로 검증한다. 만료 기준은 저장된 `expires_at`을 사용하며 이 API에서 세션 유지 기간을 새로 정하지 않는다.
- 세션 참여자가 대상 약속에 속하고 `participants.status=active`인지 검사한다. 방장 전용 API는 잠금 후 최신 `participants.role=host`를 확인한다. `host_participant_id`는 현재 ERD에 없으므로 참조하지 않는다.
- HTTPS와 `Cache-Control: no-store`를 사용한다. 변경 요청은 허용 Origin을 검증한다.
- PIN·세션 토큰·다른 사람의 개별 슬롯과 제출 상태를 JSON이나 로그에 노출하지 않는다. 후보 조회는 개별 입력 대신 공통 가능 인원만 반환한다.
