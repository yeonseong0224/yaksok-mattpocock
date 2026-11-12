import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { apiError, invalidRequest, noStore, readJsonObject } from "@/lib/api/responses";
import { loadCandidates } from "@/lib/candidates/load-candidates";
import {
  afterDeadlineExpiresAt,
  authenticate,
  extendActiveSessions,
  sessionCookieUntil,
  setSessionCookie,
  type SessionCookie,
} from "@/lib/members/session";
import { planSettingsChange } from "@/lib/promises/change-impact";
import {
  forbidden,
  invalidPromiseState,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/promises/errors";
import {
  findPromise,
  isUuid,
  lockPromise,
  settingsJson,
  type PromiseRow,
} from "@/lib/promises/promise-state";
import { parseSettingsPatchBody, type SettingsError } from "@/lib/promises/start-settings";
import { toKstIso } from "@/lib/time";

type ChangeImpactJson = {
  rangeChanged: boolean;
  hasAddedSelectableSlots: boolean;
  submissionsReset: boolean;
  removedSlotCount: number;
  /** 입력이 지워진 인원 */
  removedSlotParticipantCount: number;
  versionChangedParticipantCount: number;
  /** 이번 변경으로 제출 상태가 풀린 인원(이미 미제출이던 사람은 세지 않는다) */
  submissionsResetParticipantCount: number;
  /** 변경 후 후보가 하나라도 있는가 */
  hasCandidates: boolean;
};

type Outcome =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "not_host" }
  | { kind: "wrong_state"; status: string }
  | { kind: "invalid"; errors: SettingsError[] }
  | {
      kind: "updated";
      promise: PromiseRow;
      changeImpact: ChangeImpactJson;
      cookie: SessionCookie | null;
    };

// STATE-API-03 모집 중 설정 변경(재설정). 방장만, 모집 중이고 마감 전일 때 이름·날짜 범위·정원·마감을 바꾼다.
// 범위가 바뀌면 영향 계산(change-impact)대로 슬롯·버전·제출 상태를 한 트랜잭션에서 고친다.
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  const body = await readJsonObject(request);
  const patch = body && parseSettingsPatchBody(body);
  if (!patch) return invalidRequest();

  // 취소 여부는 세션 인증보다 먼저 본다(STATE-API-00).
  const existing = await findPromise(prisma, promiseId);
  if (!existing) return promiseNotFound();
  if (existing.status === "cancelled") return promiseCancelled();
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) return unauthenticated();

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    // 잠금 후 최신 상태·권한·DB 시각으로 다시 판정한다.
    const promise = await lockPromise(tx, promiseId);
    if (!promise) return { kind: "not_found" };
    if (promise.status === "cancelled") return { kind: "cancelled" };
    const requester = await tx.participant.findUnique({ where: { id: viewer.participantId } });
    if (requester?.status !== "active" || requester.role !== "host") return { kind: "not_host" };
    if (promise.status === "collecting" && promise.votingDeadlineAt! <= promise.now) {
      // 마감이 지났다: 기한 마감을 먼저 반영하고 변경은 거절한다(ADR-0001).
      await tx.promise.update({ where: { id: promiseId }, data: { status: "closed" } });
      return { kind: "wrong_state", status: "closed" };
    }
    if (promise.status !== "collecting") return { kind: "wrong_state", status: promise.status };

    const participants = await tx.participant.findMany({
      where: { promiseId, status: "active" },
      select: {
        id: true,
        availabilitySubmittedAt: true,
        availableSlots: { select: { slotStartAt: true } },
      },
    });
    const current = {
      dateRangeStart: promise.dateRangeStart!,
      dateRangeEnd: promise.dateRangeEnd!,
      dailyStartMinute: promise.dailyStartMinute!,
      dailyEndMinute: promise.dailyEndMinute!,
      votingDeadlineAt: promise.votingDeadlineAt!,
    };
    // 생략한 필드는 지금 값으로 채워 모집 시작과 같은 규칙으로 검증한다.
    const impact = planSettingsChange({
      current,
      next: {
        title: patch.title ?? promise.title!,
        participantLimit: patch.participantLimit ?? promise.participantLimit!,
        dateRange: patch.dateRange ?? {
          startDate: promise.dateRangeStart!,
          endDate: promise.dateRangeEnd!,
        },
        votingDeadlineAt: patch.votingDeadlineAt ?? toKstIso(promise.votingDeadlineAt!),
      },
      participants: participants.map((p) => ({
        participantId: p.id,
        slots: p.availableSlots.map((s) => s.slotStartAt.getTime()),
      })),
      now: promise.now,
    });
    if (!impact.ok) return { kind: "invalid", errors: impact.errors };
    const { settings } = impact;

    await tx.promise.update({
      where: { id: promiseId },
      data: {
        title: settings.title,
        participantLimit: settings.participantLimit,
        dateRangeStart: new Date(`${settings.dateRangeStart}T00:00:00Z`),
        dateRangeEnd: new Date(`${settings.dateRangeEnd}T00:00:00Z`),
        votingDeadlineAt: settings.votingDeadlineAt,
      },
    });
    for (const { participantId, slots } of impact.removedSlots) {
      await tx.participantAvailableSlot.deleteMany({
        where: { participantId, slotStartAt: { in: slots.map((ms) => new Date(ms)) } },
      });
    }
    if (impact.versionBumped.length > 0) {
      await tx.participant.updateMany({
        where: { id: { in: impact.versionBumped } },
        data: {
          availabilityVersion: { increment: 1 },
          // 고를 수 있는 시간이 늘면 전원의 제출 상태를 푼다(STATE-09-04). 남은 슬롯은 그대로 둔다(X-07).
          ...(impact.rangeGrew ? { availabilitySubmittedAt: null } : {}),
        },
      });
    }

    // 마감이 바뀌면 유효한 세션을 새 마감 + 7일로 맞춘다(STATE-API-03 처리 순서 8).
    let cookie: SessionCookie | null = null;
    if (settings.votingDeadlineAt.getTime() !== promise.votingDeadlineAt!.getTime()) {
      const sessionExpiresAt = afterDeadlineExpiresAt(settings.votingDeadlineAt);
      await extendActiveSessions(tx, promiseId, promise.now, sessionExpiresAt);
      cookie = sessionCookieUntil(viewer, promise.now, sessionExpiresAt);
    }

    const updated = (await findPromise(tx, promiseId))!;
    const candidates = await loadCandidates(tx, updated);
    const rangeChanged =
      settings.dateRangeStart !== current.dateRangeStart ||
      settings.dateRangeEnd !== current.dateRangeEnd;
    return {
      kind: "updated",
      promise: updated,
      cookie,
      changeImpact: {
        rangeChanged,
        hasAddedSelectableSlots: impact.rangeGrew,
        submissionsReset: impact.rangeGrew,
        removedSlotCount: impact.removedSlots.reduce((n, p) => n + p.slots.length, 0),
        removedSlotParticipantCount: impact.removedSlots.length,
        versionChangedParticipantCount: impact.versionBumped.length,
        submissionsResetParticipantCount: impact.rangeGrew
          ? participants.filter((p) => p.availabilitySubmittedAt !== null).length
          : 0,
        hasCandidates: candidates.length > 0,
      },
    };
  });

  switch (outcome.kind) {
    case "not_found":
      return promiseNotFound();
    case "cancelled":
      return promiseCancelled();
    case "not_host":
      return forbidden();
    case "wrong_state":
      return invalidPromiseState(outcome.status, ["collecting"]);
    case "invalid": {
      const [first] = outcome.errors;
      return apiError(422, first.code ?? "VALIDATION_FAILED", first.message, {
        field: first.field,
        errors: outcome.errors,
      });
    }
    case "updated": {
      const response = NextResponse.json({
        promiseId,
        promiseStatus: outcome.promise.status,
        settings: settingsJson(outcome.promise),
        changeImpact: outcome.changeImpact,
      });
      if (outcome.cookie) setSessionCookie(response, outcome.cookie);
      return noStore(response);
    }
  }
}
