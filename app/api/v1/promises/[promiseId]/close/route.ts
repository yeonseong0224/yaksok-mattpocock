import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { invalidRequest, noStore } from "@/lib/api/responses";
import {
  afterDeadlineExpiresAt,
  authenticate,
  extendActiveSessions,
  sessionCookieUntil,
  setSessionCookie,
  type SessionCookie,
} from "@/lib/members/session";
import {
  forbidden,
  invalidPromiseState,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/promises/errors";
import { findPromise, isUuid, lockPromise } from "@/lib/promises/promise-state";

type Outcome =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "not_host" }
  | { kind: "wrong_state"; status: string }
  | { kind: "closed"; cookie: SessionCookie | null };

// STATE-API-04 방장 마감. 방장만, 모집 중일 때 마감한다. 이미 마감됐으면 바꾸지 않고 200이다.
// 전원 제출은 마감 조건이 아니다(STATE-05-03).
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  const existing = await findPromise(prisma, promiseId);
  if (!existing) return promiseNotFound();
  if (existing.status === "cancelled") return promiseCancelled();
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) return unauthenticated();

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    // 잠금 후 최신 상태·권한·DB 시각으로 다시 판정한다. 제출과 경합하면 먼저 잠근 쪽이 이긴다.
    const promise = await lockPromise(tx, promiseId);
    if (!promise) return { kind: "not_found" };
    if (promise.status === "cancelled") return { kind: "cancelled" };
    const requester = await tx.participant.findUnique({ where: { id: viewer.participantId } });
    if (requester?.status !== "active" || requester.role !== "host") return { kind: "not_host" };
    if (promise.status === "closed") return { kind: "closed", cookie: null };
    if (promise.status !== "collecting") return { kind: "wrong_state", status: promise.status };

    const deadlinePassed = promise.votingDeadlineAt! <= promise.now;
    if (deadlinePassed) {
      // 마감 시각이 이미 지났다: 기한 마감을 반영만 한다. 세션은 이미 마감 + 7일이다.
      await tx.promise.update({ where: { id: promiseId }, data: { status: "closed" } });
      return { kind: "closed", cookie: null };
    }

    // 조기 마감: 실제 마감 처리 시각을 마감 시각으로 남긴다(2026-11-10 결정, ERD에 closedAt 없음).
    // 그래서 세션과 다시 로그인한 세션 모두 "실제 마감 처리 시각 + 7일"이 된다(MEMBER-06-03).
    await tx.promise.update({
      where: { id: promiseId },
      data: { status: "closed", votingDeadlineAt: promise.now },
    });
    const sessionExpiresAt = afterDeadlineExpiresAt(promise.now);
    await extendActiveSessions(tx, promiseId, promise.now, sessionExpiresAt);
    return { kind: "closed", cookie: sessionCookieUntil(viewer, promise.now, sessionExpiresAt) };
  });

  switch (outcome.kind) {
    case "not_found":
      return promiseNotFound();
    case "cancelled":
      return promiseCancelled();
    case "not_host":
      return forbidden();
    case "wrong_state":
      return invalidPromiseState(outcome.status, ["collecting", "closed"]);
    case "closed": {
      const response = NextResponse.json({ promiseId, promiseStatus: "closed" });
      if (outcome.cookie) setSessionCookie(response, outcome.cookie);
      return noStore(response);
    }
  }
}
