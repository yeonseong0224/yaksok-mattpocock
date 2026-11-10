import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { apiError, invalidRequest, noStore, readJsonObject } from "@/lib/api/responses";
import { isWithinRange, parseSlot, SLOT_LIMIT } from "@/lib/availability/slots";
import { authenticate } from "@/lib/members/session";
import { promiseCancelled, promiseNotFound, unauthenticated } from "@/lib/promises/errors";
import { effectiveStatus, findPromise, isUuid, lockPromise } from "@/lib/promises/promise-state";
import { toKstIso } from "@/lib/time";

type Outcome =
  | { kind: "not_found" | "cancelled" | "not_collecting" | "closed" | "unauthenticated" }
  | { kind: "conflict"; currentVersion: number; submitted: boolean; slots: number[] }
  | {
      kind: "saved";
      version: number;
      submittedAt: Date;
      slots: number[];
      droppedSlotCount: number;
    };

const slotsToKstIso = (slots: number[]) => slots.map((ms) => toKstIso(new Date(ms)));

// TIME-API-01 가능 시간 제출. 내 미래 슬롯 전체를 바꾸고 제출 시각·버전을 갱신한다.
// 지난 슬롯은 새로 넣지도 지우지도 않는다(TIME-08-01). 기준 버전이 다르면 덮어쓰지 않는다(TIME-10-04).
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();

  // 약속 존재·취소 → 세션 → 요청 형식 순서로 본다(STATE-API-00, TIME-API-01 처리 순서 1·2).
  const existing = await findPromise(prisma, promiseId);
  if (!existing) return promiseNotFound();
  if (existing.status === "cancelled") return promiseCancelled();
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) return unauthenticated();

  // 형식 검사는 잠금 전에 한다.
  const body = await readJsonObject(request);
  const baseVersion = body?.baseVersion;
  const rawSlots = body?.slots;
  if (
    typeof baseVersion !== "number" ||
    !Number.isInteger(baseVersion) ||
    baseVersion < 0 ||
    !Array.isArray(rawSlots)
  ) {
    return invalidRequest();
  }
  if (rawSlots.length > SLOT_LIMIT) {
    return apiError(422, "SLOT_LIMIT_EXCEEDED", "한 번에 저장할 수 있는 시간은 5,000칸까지입니다.");
  }
  const parsed = rawSlots.map(parseSlot);
  if (parsed.some((ms) => ms === null)) {
    return apiError(422, "INVALID_SLOT_FORMAT", "시간 형식이 올바르지 않습니다.");
  }
  const requested = [...new Set(parsed as number[])];

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    // 잠금 후 DB 시각으로 마감을 판정한다(API_CONVENTIONS 4.2).
    const promise = await lockPromise(tx, promiseId);
    if (!promise) return { kind: "not_found" };
    if (promise.status === "cancelled") return { kind: "cancelled" };
    if (promise.status === "draft") return { kind: "not_collecting" };
    if (promise.status !== "collecting") return { kind: "closed" };
    if (effectiveStatus(promise) === "closed") {
      // 마감 뒤 처음 들어온 쓰기 요청이 DB 상태를 closed로 바꾸고 커밋한다(ADR-0001).
      await tx.promise.update({ where: { id: promiseId }, data: { status: "closed" } });
      return { kind: "closed" };
    }

    // 세션이 유효해도 잠금 안에서 active 여부를 다시 본다(ERD 11절).
    const me = await tx.participant.findUnique({ where: { id: viewer.participantId } });
    if (!me || me.promiseId !== promiseId || me.status !== "active") {
      return { kind: "unauthenticated" };
    }

    const now = promise.now.getTime();
    // 지난 슬롯은 거절하지도 세지도 않고 무시한다. 범위 밖 슬롯은 빼고 그 수를 알려준다.
    const future = requested.filter((ms) => ms > now);
    const kept = future
      .filter((ms) =>
        isWithinRange(ms, {
          dateRangeStart: promise.dateRangeStart!,
          dateRangeEnd: promise.dateRangeEnd!,
          dailyStartMinute: promise.dailyStartMinute!,
          dailyEndMinute: promise.dailyEndMinute!,
        }),
      )
      .sort((a, b) => a - b);
    const droppedSlotCount = future.length - kept.length;

    const savedSlots = async () =>
      (
        await tx.participantAvailableSlot.findMany({
          where: { participantId: me.id },
          orderBy: { slotStartAt: "asc" },
          select: { slotStartAt: true },
        })
      ).map((s) => s.slotStartAt.getTime());

    if (me.availabilityVersion !== baseVersion) {
      const current = await savedSlots();
      const currentFuture = current.filter((ms) => ms > now);
      // 같은 내용이면 응답을 못 받고 다시 보낸 요청이다. 바꾸지 않고 성공으로 돌려준다(ERD 8.2).
      const sameAsSaved =
        me.availabilitySubmittedAt !== null &&
        currentFuture.length === kept.length &&
        currentFuture.every((ms, i) => ms === kept[i]);
      if (sameAsSaved) {
        return {
          kind: "saved",
          version: me.availabilityVersion,
          submittedAt: me.availabilitySubmittedAt!,
          slots: current,
          droppedSlotCount,
        };
      }
      return {
        kind: "conflict",
        currentVersion: me.availabilityVersion,
        submitted: me.availabilitySubmittedAt !== null,
        slots: current,
      };
    }

    // 미래 슬롯만 지우고 새로 넣는다. 지난 슬롯은 그대로 둔다.
    await tx.participantAvailableSlot.deleteMany({
      where: { participantId: me.id, slotStartAt: { gt: promise.now } },
    });
    if (kept.length > 0) {
      await tx.participantAvailableSlot.createMany({
        data: kept.map((ms) => ({ participantId: me.id, slotStartAt: new Date(ms) })),
        skipDuplicates: true,
      });
    }
    const updated = await tx.participant.update({
      where: { id: me.id },
      data: { availabilitySubmittedAt: promise.now, availabilityVersion: { increment: 1 } },
    });
    return {
      kind: "saved",
      version: updated.availabilityVersion,
      submittedAt: promise.now,
      slots: await savedSlots(),
      droppedSlotCount,
    };
  });

  switch (outcome.kind) {
    case "not_found":
      return promiseNotFound();
    case "cancelled":
      return promiseCancelled();
    case "not_collecting":
      return apiError(409, "PROMISE_NOT_COLLECTING", "아직 시간을 입력할 수 없습니다.");
    case "closed":
      return apiError(409, "VOTING_CLOSED", "응답이 마감되었습니다.");
    case "unauthenticated":
      return unauthenticated();
    case "conflict":
      return apiError(
        409,
        "AVAILABILITY_VERSION_CONFLICT",
        "다른 기기에서 먼저 저장했어요. 최신 내용을 확인해 주세요.",
        {
          currentVersion: outcome.currentVersion,
          submitted: outcome.submitted,
          slots: slotsToKstIso(outcome.slots),
        },
      );
    case "saved":
      return noStore(
        NextResponse.json({
          version: outcome.version,
          submitted: true,
          submittedAt: toKstIso(outcome.submittedAt),
          slots: slotsToKstIso(outcome.slots),
          droppedSlotCount: outcome.droppedSlotCount,
        }),
      );
  }
}
