import type { Prisma } from "@/prisma/generated/client";
import type { Db } from "@/lib/prisma";
import { DRAFT_TTL_MINUTES } from "@/lib/promises/promise-state";

export type LinkRow = {
  linkId: string;
  /** 발급 후 3개월이 지났는가(MEMBER-01-02). DB 시각 기준. */
  expired: boolean;
  promiseId: string | null;
  promiseStatus: string | null;
  /** 연결된 약속이 생성 후 10분이 지난 draft인가(STATE-02-02) */
  draftExpired: boolean;
  /** 연결된 약속이 collecting이고 마감 시각이 지났는가(ADR-0001) */
  deadlinePassed: boolean;
  /** 판정에 쓴 DB 시각(clock_timestamp) */
  now: Date;
};

type RawLinkRow = {
  link_id: string;
  expired: boolean;
  promise_id: string | null;
  promise_status: string | null;
  draft_expired: boolean;
  deadline_passed: boolean;
  now: Date;
};

/** 초대 토큰으로 링크와 연결된 약속 상태를 읽는다. 잠그지 않는다. 없으면 null. */
export async function findLink(db: Db, inviteToken: string): Promise<LinkRow | null> {
  const rows = await db.$queryRaw<RawLinkRow[]>`
    SELECT l.id AS link_id,
           l.created_at + interval '3 months' < clock_timestamp() AS expired,
           p.id AS promise_id, p.status AS promise_status,
           COALESCE(p.status = 'draft'
             AND p.created_at + make_interval(mins => ${DRAFT_TTL_MINUTES}) <= clock_timestamp(),
             false) AS draft_expired,
           COALESCE(p.status = 'collecting' AND p.voting_deadline_at <= clock_timestamp(),
             false) AS deadline_passed,
           clock_timestamp() AS now
    FROM promise_links l
    LEFT JOIN promises p ON p.promise_link_id = l.id
    WHERE l.invite_token = ${inviteToken}`;
  const row = rows[0];
  if (!row) return null;
  return {
    linkId: row.link_id,
    expired: row.expired,
    promiseId: row.promise_id,
    promiseStatus: row.promise_status,
    draftExpired: row.draft_expired,
    deadlinePassed: row.deadline_passed,
    now: row.now,
  };
}

/**
 * 링크 행 → 연결된 약속 행 순서로 FOR UPDATE 잠금을 잡은 뒤 상태를 다시 읽는다(API_CONVENTIONS 4.1).
 *
 * 잠금과 읽기를 별도 문장으로 나눈다. READ COMMITTED에서 다음 문장은 새 스냅숏을 보므로,
 * 잠금을 기다리는 사이 다른 트랜잭션이 커밋한 약속과 잠금 후의 clock_timestamp()(4.2)를 본다.
 */
export async function lockLink(
  tx: Prisma.TransactionClient,
  inviteToken: string,
): Promise<LinkRow | null> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM promise_links WHERE invite_token = ${inviteToken} FOR UPDATE`;
  if (locked.length === 0) return null;
  await tx.$queryRaw`
    SELECT id FROM promises WHERE promise_link_id = ${locked[0].id}::uuid FOR UPDATE`;
  return findLink(tx, inviteToken);
}
