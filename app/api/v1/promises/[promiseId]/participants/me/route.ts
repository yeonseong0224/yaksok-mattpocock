import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { invalidRequest, noStore } from "@/lib/api/responses";
import { authenticate, clearSessionCookie, expireAllSessions } from "@/lib/members/session";
import { endMembership } from "@/lib/members/membership";
import { promiseCancelled, promiseNotFound, unauthenticated } from "@/lib/promises/errors";
import {
  deleteDraft,
  effectiveStatus,
  findPromise,
  isUuid,
  lockPromise,
  type PromiseStatus,
} from "@/lib/promises/promise-state";
import { toKstIso } from "@/lib/time";

type Outcome =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "unauthenticated" }
  | { kind: "draft_discarded" }
  | {
      kind: "left";
      promiseStatus: PromiseStatus;
      participantCancelledAt: Date;
      newHostParticipantId: string | null;
    }
  | { kind: "promise_cancelled"; promiseCancelledAt: Date };

// STATE-API-08 본인 탈퇴와 방장 자동 승계(약속 관리 티켓 06).
// 모집 중·마감·확정 언제든 나갈 수 있다(2026-11-11 결정, MEMBER-10-01). 방장이 나가면 가장 먼저 들어온
// active 참여자가 방장이 되고(MEMBER-12-01), 남은 사람이 없으면 약속을 취소한다(MEMBER-12-04).
// draft에서 방장이 나가면 초안을 지우고 링크를 처음 상태로 돌린다.
export async function DELETE(
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
    // 링크 → 약속 순서로 잠근 뒤 최신 상태·역할로 다시 판정한다. 방장과 다음 순번이 동시에 나가도
    // 이 잠금으로 한 줄로 처리되고, 늦은 쪽은 바뀐 역할(승계된 방장 등)로 판정된다.
    const promise = await lockPromise(tx, promiseId);
    if (!promise) return { kind: "not_found" };
    if (promise.status === "cancelled") return { kind: "cancelled" };
    const me = await tx.participant.findUnique({ where: { id: viewer.participantId } });
    if (me?.status !== "active") return { kind: "unauthenticated" };
    const now = promise.now;

    if (promise.status === "draft") {
      // draft의 참여자는 방장뿐이다. 초안을 지우면 링크는 다른 사람이 다시 방장 등록할 수 있다.
      await deleteDraft(tx, promiseId);
      return { kind: "draft_discarded" };
    }

    let newHostParticipantId: string | null = null;
    if (me.role === "host") {
      // 제출 여부와 상관없이 가장 먼저 들어온 active 참여자(MEMBER-12-01, STATE-API-08 처리 순서 5)
      const successor = await tx.participant.findFirst({
        where: { promiseId, status: "active", id: { not: me.id } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (!successor) {
        // 후임이 없으면 탈퇴 대신 약속을 취소한다. 방장 행은 host·active 그대로 둔다(처리 순서 7).
        await tx.promise.update({
          where: { id: promiseId },
          data: { status: "cancelled", cancelledAt: now },
        });
        await expireAllSessions(tx, promiseId, now);
        return { kind: "promise_cancelled", promiseCancelledAt: now };
      }
      newHostParticipantId = successor.id;
    }

    // 약속당 방장은 한 명이라(유니크 인덱스) 나가는 방장을 먼저 member로 내린 뒤 후임을 올린다.
    await endMembership(tx, me.id, now);
    if (newHostParticipantId) {
      await tx.participant.update({ where: { id: newHostParticipantId }, data: { role: "host" } });
    }
    return {
      kind: "left",
      promiseStatus: effectiveStatus(promise),
      participantCancelledAt: now,
      newHostParticipantId,
    };
  });

  switch (outcome.kind) {
    case "not_found":
      return promiseNotFound();
    case "cancelled":
      return promiseCancelled();
    case "unauthenticated":
      return unauthenticated();
    case "draft_discarded":
      return done(promiseId, { result: "draft_discarded", promiseId: null });
    case "promise_cancelled":
      return done(promiseId, {
        promiseId,
        promiseStatus: "cancelled",
        participantStatus: "active",
        participantCancelledAt: null,
        hostTransferred: false,
        newHostParticipantId: null,
        promiseCancelledAt: toKstIso(outcome.promiseCancelledAt),
      });
    case "left":
      return done(promiseId, {
        promiseId,
        promiseStatus: outcome.promiseStatus,
        participantStatus: "cancelled",
        participantCancelledAt: toKstIso(outcome.participantCancelledAt),
        hostTransferred: outcome.newHostParticipantId !== null,
        newHostParticipantId: outcome.newHostParticipantId,
        promiseCancelledAt: null,
      });
  }
}

/** 나간 뒤에는 이 기기의 세션 쿠키를 지운다. */
function done(promiseId: string, body: Record<string, unknown>) {
  const response = NextResponse.json(body);
  clearSessionCookie(response, promiseId);
  return noStore(response);
}
