import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { invalidRequest, noStore } from "@/lib/api/responses";
import { authenticate, clearSessionCookie, expireAllSessions } from "@/lib/members/session";
import {
  forbidden,
  invalidPromiseState,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/promises/errors";
import { findPromise, isUuid, lockPromise } from "@/lib/promises/promise-state";
import { toKstIso } from "@/lib/time";

type Outcome =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "not_host" }
  | { kind: "wrong_state"; status: string }
  | { kind: "done"; cancelledAt: Date };

// STATE-API-07 약속 취소. 방장만, 모집 중·마감·확정에서 취소한다(2026-11-11 결정, STATE-10-02). 되돌릴 수 없다.
// 설정과 참여자 데이터는 그대로 두고, 그 약속의 모든 세션만 즉시 만료한다.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  // 이미 취소됐으면 세션 인증보다 먼저 409다(STATE-API-00).
  const existing = await findPromise(prisma, promiseId);
  if (!existing) return promiseNotFound();
  if (existing.status === "cancelled") return promiseCancelled();
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) return unauthenticated();

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    // 잠금 후 최신 상태·권한으로 다시 판정한다. 확정·재조율 등과 겹치면 먼저 잠근 쪽이 이긴다.
    const promise = await lockPromise(tx, promiseId);
    if (!promise) return { kind: "not_found" };
    if (promise.status === "cancelled") return { kind: "cancelled" };
    const requester = await tx.participant.findUnique({ where: { id: viewer.participantId } });
    if (requester?.status !== "active" || requester.role !== "host") return { kind: "not_host" };
    // 초안은 취소가 아니라 방장 나가기(초안 삭제)로 없앤다(STATE-API-08).
    if (promise.status === "draft") return { kind: "wrong_state", status: promise.status };

    // 마감 시각이 지난 collecting도 그대로 취소한다. 참여자의 role·status·슬롯·확정 일정은 바꾸지 않는다.
    await tx.promise.update({
      where: { id: promiseId },
      data: { status: "cancelled", cancelledAt: promise.now },
    });
    await expireAllSessions(tx, promiseId, promise.now);
    return { kind: "done", cancelledAt: promise.now };
  });

  switch (outcome.kind) {
    case "not_found":
      return promiseNotFound();
    case "cancelled":
      return promiseCancelled();
    case "not_host":
      return forbidden();
    case "wrong_state":
      return invalidPromiseState(outcome.status, ["collecting", "closed", "confirmed"]);
    case "done": {
      const response = NextResponse.json({
        promiseId,
        promiseStatus: "cancelled",
        cancelledAt: toKstIso(outcome.cancelledAt),
        message: "취소된 약속입니다.",
      });
      clearSessionCookie(response, promiseId);
      return noStore(response);
    }
  }
}
