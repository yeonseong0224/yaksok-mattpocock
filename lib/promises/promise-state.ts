import type { Prisma } from "@/prisma/generated/client";
import type { Db } from "@/lib/prisma";
import { addMinutes, minuteToHhmm, toKstIso } from "@/lib/time";

/** draft는 생성 후 이 시간 안에 설정을 마쳐야 한다(STATE-02-02) */
export const DRAFT_TTL_MINUTES = 10;

export type PromiseStatus = "draft" | "collecting" | "closed" | "confirmed" | "cancelled";

export type PromiseRow = {
  id: string;
  promiseLinkId: string;
  title: string | null;
  participantLimit: number | null;
  /** YYYY-MM-DD */
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  dailyStartMinute: number | null;
  dailyEndMinute: number | null;
  durationMinutes: number | null;
  votingDeadlineAt: Date | null;
  status: PromiseStatus;
  confirmedStartAt: Date | null;
  createdAt: Date;
  /** 판정에 쓴 DB 시각(clock_timestamp) */
  now: Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

/** 약속 행과 판정 시각을 읽는다. 잠그지 않는다. 없으면 null. */
export async function findPromise(db: Db, promiseId: string): Promise<PromiseRow | null> {
  const rows = await db.$queryRaw<
    {
      id: string;
      promise_link_id: string;
      title: string | null;
      participant_limit: number | null;
      date_range_start: string | null;
      date_range_end: string | null;
      daily_start_minute: number | null;
      daily_end_minute: number | null;
      duration_minutes: number | null;
      voting_deadline_at: Date | null;
      status: PromiseStatus;
      confirmed_start_at: Date | null;
      created_at: Date;
      now: Date;
    }[]
  >`
    SELECT id, promise_link_id, title, participant_limit,
           to_char(date_range_start, 'YYYY-MM-DD') AS date_range_start,
           to_char(date_range_end, 'YYYY-MM-DD') AS date_range_end,
           daily_start_minute, daily_end_minute, duration_minutes, voting_deadline_at,
           status, confirmed_start_at, created_at, clock_timestamp() AS now
    FROM promises WHERE id = ${promiseId}::uuid`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    promiseLinkId: r.promise_link_id,
    title: r.title,
    participantLimit: r.participant_limit,
    dateRangeStart: r.date_range_start,
    dateRangeEnd: r.date_range_end,
    dailyStartMinute: r.daily_start_minute,
    dailyEndMinute: r.daily_end_minute,
    durationMinutes: r.duration_minutes,
    votingDeadlineAt: r.voting_deadline_at,
    status: r.status,
    confirmedStartAt: r.confirmed_start_at,
    createdAt: r.created_at,
    now: r.now,
  };
}

/**
 * 쓰기 요청용: 링크 행 → 약속 행 순서로 FOR UPDATE 잠근 뒤 약속을 다시 읽는다(API_CONVENTIONS 4.1).
 * draft를 지울 수 있는 요청도 이 순서를 따른다. 잠금과 읽기를 나눠 잠금 후의 최신 값과 DB 시각을 본다.
 */
export async function lockPromise(
  tx: Prisma.TransactionClient,
  promiseId: string,
): Promise<PromiseRow | null> {
  const found = await tx.$queryRaw<{ promise_link_id: string }[]>`
    SELECT promise_link_id FROM promises WHERE id = ${promiseId}::uuid`;
  if (found.length === 0) return null;
  await tx.$queryRaw`
    SELECT id FROM promise_links WHERE id = ${found[0].promise_link_id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM promises WHERE id = ${promiseId}::uuid FOR UPDATE`;
  return findPromise(tx, promiseId);
}

export function draftExpiresAt(row: Pick<PromiseRow, "createdAt">): Date {
  return addMinutes(row.createdAt, DRAFT_TTL_MINUTES);
}

/** 생성 후 10분이 지난 draft인가. 경계값(정확히 10분)은 만료다(API_CONVENTIONS 4.2). */
export function isDraftExpired(row: Pick<PromiseRow, "status" | "createdAt" | "now">): boolean {
  return row.status === "draft" && draftExpiresAt(row) <= row.now;
}

/** 조회용 상태: collecting이어도 마감 시각이 지났으면 closed(ADR-0001, STATE-05-01) */
export function effectiveStatus(
  row: Pick<PromiseRow, "status" | "votingDeadlineAt" | "now">,
): PromiseStatus {
  if (row.status === "collecting" && row.votingDeadlineAt && row.votingDeadlineAt <= row.now) {
    return "closed";
  }
  return row.status;
}

/**
 * 만료된 draft를 지운다: 세션 → 방장 참여자 → promise 순서(ERD 10절). 링크는 미사용 상태로 남는다.
 * 호출하는 쪽이 `lockPromise`나 링크 잠금으로 링크 → 약속을 먼저 잠가야 한다.
 */
export async function deleteDraft(tx: Prisma.TransactionClient, promiseId: string) {
  await tx.participantSession.deleteMany({ where: { participant: { promiseId } } });
  await tx.participant.deleteMany({ where: { promiseId } });
  await tx.promise.delete({ where: { id: promiseId } });
}

/** STATE-API-01의 settings 객체. 미설정 값은 null이다. */
export function settingsJson(row: PromiseRow) {
  return {
    title: row.title,
    participantLimit: row.participantLimit,
    dateRange: { startDate: row.dateRangeStart, endDate: row.dateRangeEnd },
    dailyTimeRange: {
      startTime: row.dailyStartMinute === null ? null : minuteToHhmm(row.dailyStartMinute),
      endTime: row.dailyEndMinute === null ? null : minuteToHhmm(row.dailyEndMinute),
    },
    durationMinutes: row.durationMinutes,
    votingDeadlineAt: row.votingDeadlineAt ? toKstIso(row.votingDeadlineAt) : null,
  };
}
