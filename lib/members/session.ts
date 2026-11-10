import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@/prisma/generated/client";
import type { Db } from "@/lib/prisma";
import type { PromiseRow } from "@/lib/promises/promise-state";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** draft에서 발급한 세션의 유지 시간(MEMBER-06-03) */
const DRAFT_SESSION_MS = 24 * HOUR_MS;
/** 마감 뒤 로그인 상태를 유지하는 기간(MEMBER-06-03) */
const AFTER_DEADLINE_MS = 7 * DAY_MS;

/** 브라우저에 쿠키로 내려줄 세션 */
export type SessionCookie = { promiseId: string; token: string; maxAgeSeconds: number };

/** 요청을 보낸 참여자(세션으로 확인됨) */
export type Viewer = {
  participantId: string;
  role: "host" | "member";
  /** 현재 세션의 DB 만료 시각 */
  expiresAt: Date;
  cookie: SessionCookie;
};

const cookieName = (promiseId: string) => `ys_session_${promiseId}`;
/** 세션 토큰의 DB 저장값. 원본 토큰은 저장하지 않는다. */
export const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");
const secondsBetween = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

// 새 세션의 만료 시각(MEMBER-06-03, API_CONVENTIONS 5.2)

/** draft에서 발급하는 세션: 발급 시각 + 24시간 */
export function draftSessionExpiresAt(now: Date): Date {
  return new Date(now.getTime() + DRAFT_SESSION_MS);
}

/** 모집 시작 이후 세션: 마감 + 7일. 모집 시작 때 모든 세션도 이 시각으로 늘린다. */
export function afterDeadlineExpiresAt(votingDeadlineAt: Date): Date {
  return new Date(votingDeadlineAt.getTime() + AFTER_DEADLINE_MS);
}

/**
 * 로그인(재인증) 세션. 마감 + 7일이 지난 뒤에도 로그인할 수 있으므로 `max(마감 + 7일, 로그인 시각 + 7일)`.
 * draft에서는 draft 세션과 같다.
 * 조기 마감(티켓 08)에서는 기준이 실제 마감 처리 시각 + 7일이어야 한다.
 */
export function loginSessionExpiresAt(
  promise: Pick<PromiseRow, "status" | "votingDeadlineAt" | "now">,
): Date {
  if (promise.status === "draft" || !promise.votingDeadlineAt) {
    return draftSessionExpiresAt(promise.now);
  }
  const base = afterDeadlineExpiresAt(promise.votingDeadlineAt).getTime();
  return new Date(Math.max(base, promise.now.getTime() + AFTER_DEADLINE_MS));
}

/**
 * 세션을 만든다. DB에는 토큰의 해시와 만료 시각만 저장하고,
 * 원본 토큰은 `setSessionCookie`로 같은 만료의 쿠키에 담아 브라우저에만 내려준다.
 * 기기마다 세션을 따로 만든다(여러 기기 동시 로그인, MEMBER-04-02).
 */
export async function issueSession(
  db: Db,
  participant: { id: string; promiseId: string },
  now: Date,
  expiresAt: Date,
): Promise<SessionCookie> {
  const token = randomBytes(32).toString("base64url");
  await db.participantSession.create({
    data: {
      participantId: participant.id,
      sessionTokenHash: hashSessionToken(token),
      expiresAt,
    },
  });
  return { promiseId: participant.promiseId, token, maxAgeSeconds: secondsBetween(now, expiresAt) };
}

/**
 * 요청의 약속별 세션 쿠키로 참여자를 확인한다. 세션이 없거나 만료됐거나,
 * 참여자가 이 약속의 active 참여자가 아니면 null(API_CONVENTIONS 5장 매 요청 재검증).
 * 돌려주는 쿠키의 Max-Age는 DB의 현재 만료 시각 기준이라, 응답에 다시 실으면 쿠키 만료가 DB와 맞춰진다.
 */
export async function authenticate(
  db: Db,
  request: NextRequest,
  promiseId: string,
): Promise<Viewer | null> {
  const token = request.cookies.get(cookieName(promiseId))?.value;
  if (!token) return null;
  const rows = await db.$queryRaw<
    { participant_id: string; role: "host" | "member"; expires_at: Date; now: Date }[]
  >`
    SELECT p.id AS participant_id, p.role, s.expires_at,
           clock_timestamp() AS now
    FROM participant_sessions s
    JOIN participants p ON p.id = s.participant_id
    WHERE s.session_token_hash = ${hashSessionToken(token)}
      AND p.promise_id = ${promiseId}::uuid
      AND p.status = 'active'
      AND s.expires_at > clock_timestamp()`;
  const row = rows[0];
  if (!row) return null;
  return {
    participantId: row.participant_id,
    role: row.role,
    expiresAt: row.expires_at,
    cookie: { promiseId, token, maxAgeSeconds: secondsBetween(row.now, row.expires_at) },
  };
}

/** 요청에 이 약속의 세션 쿠키가 있는가(만료 여부와 무관) */
export function hasSessionCookie(request: NextRequest, promiseId: string): boolean {
  return Boolean(request.cookies.get(cookieName(promiseId))?.value);
}

/**
 * 이 기기의 세션을 끝낸다(로그아웃). 행은 지우지 않고 만료 시각을 지금으로 바꾼다(티켓 04).
 * 이미 만료됐거나 없는 세션이어도 조용히 넘어간다.
 */
export async function revokeSession(db: Db, request: NextRequest, promiseId: string) {
  const token = request.cookies.get(cookieName(promiseId))?.value;
  if (!token) return;
  await db.$executeRaw`
    UPDATE participant_sessions s SET expires_at = clock_timestamp()
    FROM participants p
    WHERE p.id = s.participant_id
      AND p.promise_id = ${promiseId}::uuid
      AND s.session_token_hash = ${hashSessionToken(token)}
      AND s.expires_at > clock_timestamp()`;
}

/**
 * 약속의 active 참여자들의 유효한 세션 만료 시각을 바꾼다(모집 시작·마감 시 MEMBER-06-03).
 * 이미 만료된 세션은 되살리지 않는다.
 */
export async function extendActiveSessions(
  tx: Prisma.TransactionClient,
  promiseId: string,
  now: Date,
  expiresAt: Date,
) {
  await tx.participantSession.updateMany({
    where: { expiresAt: { gt: now }, participant: { promiseId, status: "active" } },
    data: { expiresAt },
  });
}

/** 약속별 httpOnly 세션 쿠키(API_CONVENTIONS 5장). Path를 그 약속의 API 경로로 좁힌다. */
export function setSessionCookie(response: NextResponse, cookie: SessionCookie) {
  response.cookies.set(cookieName(cookie.promiseId), cookie.token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: `/api/v1/promises/${cookie.promiseId}`,
    maxAge: cookie.maxAgeSeconds,
  });
}

/** 브라우저의 세션 쿠키를 지운다(로그아웃). */
export function clearSessionCookie(response: NextResponse, promiseId: string) {
  setSessionCookie(response, { promiseId, token: "", maxAgeSeconds: 0 });
}

export function sessionCookieUntil(viewer: Viewer, now: Date, expiresAt: Date): SessionCookie {
  return { ...viewer.cookie, maxAgeSeconds: secondsBetween(now, expiresAt) };
}
