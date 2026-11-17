import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { apiError, invalidRequest, noStore, readJsonObject } from "@/lib/api/responses";
import {
  candidateBlockJson,
  loadPickedWindow,
  scheduledTimeJson,
  type NamedBlock,
  type ScheduledTime,
} from "@/lib/candidates/load-candidates";
import { authenticate, setSessionCookie } from "@/lib/members/session";
import {
  forbidden,
  invalidPromiseState,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/promises/errors";
import { findPromise, isUuid, lockPromise } from "@/lib/promises/promise-state";

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

type Outcome =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "unauthenticated" }
  | { kind: "not_host" }
  | { kind: "still_collecting" }
  | { kind: "wrong_state"; status: string }
  | { kind: "not_a_candidate"; blocks: NamedBlock[] }
  | { kind: "confirmed"; confirmation: ScheduledTime };

// STATE-API-05 확정. 방장만, 마감된 약속에서, 화면에 표시된 후보(서로 겹치지 않는 최대 5개) 중 하나만 확정한다.
// 서버가 잠금 후 후보를 다시 계산해, 요청한 시작 시각이 표시 후보가 아니면 409와 새 후보 목록을 돌려준다
// (RESULT-11-02·12-01·12-02, 첫 슬라이스 결정. state.md 원안의 422·목록 밖 허용과 다르다).
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

  const body = await readJsonObject(request);
  if (!body || !("startAt" in body)) return invalidRequest();
  const startAt = typeof body.startAt === "string" ? body.startAt : "";
  const startMs = ISO_WITH_OFFSET.test(startAt) ? Date.parse(startAt) : NaN;
  if (Number.isNaN(startMs)) {
    return apiError(422, "VALIDATION_FAILED", "확정 시작 시각을 확인해 주세요.", {
      field: "startAt",
    });
  }

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    const promise = await lockPromise(tx, promiseId);
    if (!promise) return { kind: "not_found" };
    if (promise.status === "cancelled") return { kind: "cancelled" };
    const requester = await tx.participant.findUnique({ where: { id: viewer.participantId } });
    if (requester?.status !== "active") return { kind: "unauthenticated" };
    if (requester.role !== "host") return { kind: "not_host" };

    if (promise.status === "collecting") {
      if (promise.votingDeadlineAt! > promise.now) return { kind: "still_collecting" };
      // 마감 시각이 지난 모집은 이 요청이 먼저 마감으로 바꾸고 이어서 확정한다(ADR-0001, STATE-API-05 처리 순서 2).
      await tx.promise.update({ where: { id: promiseId }, data: { status: "closed" } });
    } else if (promise.status !== "closed") {
      return { kind: "wrong_state", status: promise.status };
    }

    // 잠금 후 DB 시각으로 후보 블록을 다시 계산하고, 그 안에서 고른 창이 확정할 수 있는지 본다
    // (블록 안 30분 경계 시작, 약속 길이 내내 2명 이상, candidate-blocks 03). 오프셋 표기는 상관없다.
    const { picked, blocks } = await loadPickedWindow(tx, promise, startMs);
    if (!picked) return { kind: "not_a_candidate", blocks };

    // 시작 시각만 저장한다(RESULT-13-01). 제출 상태·슬롯은 그대로 둔다.
    await tx.promise.update({
      where: { id: promiseId },
      data: { status: "confirmed", confirmedStartAt: picked.startAt },
    });
    // 같은 트랜잭션에서 방금 계산한 후보라 참석 가능한 사람도 그대로다.
    return { kind: "confirmed", confirmation: picked };
  });

  switch (outcome.kind) {
    case "not_found":
      return promiseNotFound();
    case "cancelled":
      return promiseCancelled();
    case "unauthenticated":
      return unauthenticated();
    case "not_host":
      return forbidden();
    case "still_collecting":
      // STATE-07-01: 모집 중에 확정하려면 먼저 조기 마감한다.
      return invalidPromiseState(
        "collecting",
        ["closed"],
        "모집 중에는 확정할 수 없어요. 먼저 조기 마감해 주세요.",
      );
    case "wrong_state":
      return invalidPromiseState(outcome.status, ["closed"]);
    case "not_a_candidate":
      return apiError(
        409,
        "INVALID_CONFIRMATION_CANDIDATE",
        "후보가 바뀌었거나 더 이상 유효하지 않아요. 새 후보를 확인해 주세요.",
        { blocks: outcome.blocks.map(candidateBlockJson) },
      );
    case "confirmed": {
      const response = NextResponse.json({
        promiseId,
        promiseStatus: "confirmed",
        currentConfirmation: scheduledTimeJson(outcome.confirmation),
      });
      setSessionCookie(response, viewer.cookie);
      return noStore(response);
    }
  }
}
