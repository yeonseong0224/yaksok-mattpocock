/*
  Warnings:

  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "users";

-- CreateTable
CREATE TABLE "promise_links" (
    "id" UUID NOT NULL,
    "invite_token" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promise_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promises" (
    "id" UUID NOT NULL,
    "promise_link_id" UUID NOT NULL,
    "title" VARCHAR(200),
    "participant_limit" INTEGER,
    "date_range_start" DATE,
    "date_range_end" DATE,
    "daily_start_minute" SMALLINT,
    "daily_end_minute" SMALLINT,
    "duration_minutes" INTEGER,
    "voting_deadline_at" TIMESTAMPTZ(3),
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "confirmed_start_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL,
    "promise_id" UUID NOT NULL,
    "nickname" VARCHAR(200) NOT NULL,
    "normalized_nickname" VARCHAR(200) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "availability_submitted_at" TIMESTAMPTZ(3),
    "availability_version" INTEGER NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_available_slots" (
    "id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "slot_start_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_available_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participant_sessions" (
    "id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "session_token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "participant_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promise_links_invite_token_key" ON "promise_links"("invite_token");

-- CreateIndex
CREATE UNIQUE INDEX "promises_promise_link_id_key" ON "promises"("promise_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "participants_promise_id_normalized_nickname_key" ON "participants"("promise_id", "normalized_nickname");

-- CreateIndex
CREATE UNIQUE INDEX "participant_available_slots_participant_id_slot_start_at_key" ON "participant_available_slots"("participant_id", "slot_start_at");

-- CreateIndex
CREATE UNIQUE INDEX "participant_sessions_session_token_hash_key" ON "participant_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "participant_sessions_participant_id_idx" ON "participant_sessions"("participant_id");

-- AddForeignKey
ALTER TABLE "promises" ADD CONSTRAINT "promises_promise_link_id_fkey" FOREIGN KEY ("promise_link_id") REFERENCES "promise_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_promise_id_fkey" FOREIGN KEY ("promise_id") REFERENCES "promises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_available_slots" ADD CONSTRAINT "participant_available_slots_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 아래는 Prisma 스키마로 표현할 수 없어 직접 작성한 제약이다 (ERD 4.1·4.2).
-- 현재 시각 비교와 다른 테이블 확인은 CHECK에 넣지 않고 서버에서 판정한다.
-- ---------------------------------------------------------------------------

-- 방장은 약속당 최대 한 명
CREATE UNIQUE INDEX "uq_one_host_per_promise" ON "participants"("promise_id") WHERE "role" = 'host';

-- promises: 허용 상태
ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_status"
CHECK ("status" IN ('draft', 'collecting', 'closed', 'confirmed', 'cancelled'));

-- promises: cancelled일 때만 cancelled_at 존재
ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_cancelled_at"
CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL));

-- promises: 약속 이름은 비어 있지 않고 앞뒤 공백이 없다.
-- 1~30자 상한은 서버가 검증한다(화면 글자 수와 코드 포인트 수가 다를 수 있어 DB에서 세지 않는다).
ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_title"
CHECK ("title" IS NULL OR ("title" = btrim("title") AND "title" <> ''));

-- promises: 정원은 방장 포함 2~30명
ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_participant_limit"
CHECK ("participant_limit" IS NULL OR "participant_limit" BETWEEN 2 AND 30);

-- promises: 날짜 범위는 시작 ≤ 종료, 양 끝 포함 최대 90일
ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_date_range"
CHECK (
  "date_range_start" IS NULL OR "date_range_end" IS NULL
  OR ("date_range_start" <= "date_range_end" AND "date_range_end" - "date_range_start" <= 89)
);

-- promises: 하루 시간 범위는 30분 배수 분 값, 시작 0~1410, 종료 30~1440, 시작 < 종료
ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_daily_start_minute"
CHECK ("daily_start_minute" IS NULL OR ("daily_start_minute" BETWEEN 0 AND 1410 AND "daily_start_minute" % 30 = 0));

ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_daily_end_minute"
CHECK ("daily_end_minute" IS NULL OR ("daily_end_minute" BETWEEN 30 AND 1440 AND "daily_end_minute" % 30 = 0));

ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_daily_range"
CHECK ("daily_start_minute" IS NULL OR "daily_end_minute" IS NULL OR "daily_start_minute" < "daily_end_minute");

-- promises: 약속 길이는 30분 이상 30분 배수, 하루 시간 범위 이하
ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_duration_minutes"
CHECK ("duration_minutes" IS NULL OR ("duration_minutes" >= 30 AND "duration_minutes" % 30 = 0));

ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_duration_within_daily_range"
CHECK (
  "duration_minutes" IS NULL OR "daily_start_minute" IS NULL OR "daily_end_minute" IS NULL
  OR "duration_minutes" <= "daily_end_minute" - "daily_start_minute"
);

-- promises: collecting 이상(취소 제외)에서는 설정값이 모두 필수
ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_settings_required"
CHECK (
  "status" NOT IN ('collecting', 'closed', 'confirmed')
  OR (
    "title" IS NOT NULL
    AND "participant_limit" IS NOT NULL
    AND "date_range_start" IS NOT NULL
    AND "date_range_end" IS NOT NULL
    AND "daily_start_minute" IS NOT NULL
    AND "daily_end_minute" IS NOT NULL
    AND "duration_minutes" IS NOT NULL
    AND "voting_deadline_at" IS NOT NULL
  )
);

-- promises: confirmed에서는 확정 시작 시각 필수, draft·collecting·closed에서는 NULL
ALTER TABLE "promises" ADD CONSTRAINT "ck_promise_confirmed_start_at"
CHECK (
  ("status" <> 'confirmed' OR "confirmed_start_at" IS NOT NULL)
  AND ("status" NOT IN ('draft', 'collecting', 'closed') OR "confirmed_start_at" IS NULL)
);

-- participants: 허용 역할·상태
ALTER TABLE "participants" ADD CONSTRAINT "ck_participant_role"
CHECK ("role" IN ('host', 'member'));

ALTER TABLE "participants" ADD CONSTRAINT "ck_participant_status"
CHECK ("status" IN ('active', 'cancelled'));

-- participants: 방장은 active여야 함
ALTER TABLE "participants" ADD CONSTRAINT "ck_host_must_be_active"
CHECK ("role" <> 'host' OR "status" = 'active');

-- participants: cancelled일 때만 cancelled_at 존재
ALTER TABLE "participants" ADD CONSTRAINT "ck_participant_cancelled_at"
CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL));

-- participants: 응답 버전은 0 이상
ALTER TABLE "participants" ADD CONSTRAINT "ck_participant_availability_version"
CHECK ("availability_version" >= 0);

-- participant_available_slots: 30분 경계(00분·30분, 초·소수 초 0).
-- 한국 시간 오프셋(+9시간)이 30분의 배수이므로 epoch 기준 검사와 같다.
ALTER TABLE "participant_available_slots" ADD CONSTRAINT "ck_slot_start_on_30_minute_boundary"
CHECK (extract(epoch FROM "slot_start_at") % 1800 = 0);
