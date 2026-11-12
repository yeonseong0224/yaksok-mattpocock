import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { apiError, invalidRequest, noStore } from "@/lib/api/responses";
import { endMembership } from "@/lib/members/membership";
import { authenticate } from "@/lib/members/session";
import {
  deadlinePassed,
  invalidPromiseState,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/promises/errors";
import { findPromise, isUuid, lockPromise } from "@/lib/promises/promise-state";

type Outcome =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "unauthenticated" }
  | { kind: "not_host" }
  | { kind: "wrong_state"; status: string }
  | { kind: "deadline_passed" }
  | { kind: "target_not_found" }
  | { kind: "self" }
  | { kind: "removed"; currentParticipantCount: number; participantLimit: number | null };

const participantNotFound = () =>
  apiError(404, "PARTICIPANT_NOT_FOUND", "참여자를 찾을 수 없습니다.");
const cannotRemoveSelf = () =>
  apiError(409, "CANNOT_REMOVE_SELF", "방장은 스스로를 내보낼 수 없습니다. 탈퇴를 이용해 주세요.");

// MEMBER-API-08 참여자 내보내기(약속 관리 티켓 07). 방장만, 모집 중이고 마감 전이면 언제든
// (처음 모집·재조율 모두, 2026-11-11 결정 MEMBER-10-02). 멤버십 종료 처리는 본인 탈퇴와 같다(endMembership).
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string; participantId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId, participantId } = await context.params;
  if (!isUuid(promiseId) || !isUuid(participantId)) return invalidRequest();
  // 취소 여부는 세션 인증보다 먼저 본다(C-10).
  const existing = await findPromise(prisma, promiseId);
  if (!existing) return promiseNotFound();
  if (existing.status === "cancelled") return promiseCancelled();
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) return unauthenticated();

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    // 잠금 후 권한·상태·마감·대상을 다시 확인한다(처리 순서 1~6).
    const promise = await lockPromise(tx, promiseId);
    if (!promise) return { kind: "not_found" };
    if (promise.status === "cancelled") return { kind: "cancelled" };
    const requester = await tx.participant.findUnique({ where: { id: viewer.participantId } });
    // 요청자가 그 사이 나갔으면 401, 방장이 아니면 403(MEMBER-API-08 오류표)
    if (requester?.status !== "active") return { kind: "unauthenticated" };
    if (requester.role !== "host") return { kind: "not_host" };
    if (promise.status !== "collecting") return { kind: "wrong_state", status: promise.status };
    if (promise.votingDeadlineAt! <= promise.now) {
      // 마감이 지났다: 기한 마감을 먼저 반영하고(이 변경은 커밋한다) 거절한다(ADR-0001).
      await tx.promise.update({ where: { id: promiseId }, data: { status: "closed" } });
      return { kind: "deadline_passed" };
    }
    const target = await tx.participant.findUnique({ where: { id: participantId } });
    if (target?.promiseId !== promiseId) return { kind: "target_not_found" };
    if (target.id === requester.id) return { kind: "self" };
    // 이미 나갔거나 내보내졌으면 바꾸지 않는다(멱등).
    if (target.status === "active") await endMembership(tx, target.id, promise.now);

    const currentParticipantCount = await tx.participant.count({
      where: { promiseId, status: "active" },
    });
    return {
      kind: "removed",
      currentParticipantCount,
      participantLimit: promise.participantLimit,
    };
  });

  switch (outcome.kind) {
    case "not_found":
      return promiseNotFound();
    case "cancelled":
      return promiseCancelled();
    case "unauthenticated":
      return unauthenticated();
    case "not_host":
      return apiError(403, "FORBIDDEN", "방장만 내보낼 수 있습니다.");
    case "wrong_state":
      return invalidPromiseState(outcome.status, ["collecting"], "모집 중에만 내보낼 수 있습니다.");
    case "deadline_passed":
      return deadlinePassed();
    case "target_not_found":
      return participantNotFound();
    case "self":
      return cannotRemoveSelf();
    case "removed":
      return noStore(
        NextResponse.json({
          participantId,
          participantStatus: "cancelled",
          currentParticipantCount: outcome.currentParticipantCount,
          participantLimit: outcome.participantLimit,
        }),
      );
  }
}
