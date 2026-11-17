import type { Prisma } from "@/prisma/generated/client";
import { loadCandidateBlocks } from "@/lib/candidates/load-candidates";
import { afterDeadlineExpiresAt, extendActiveSessions } from "@/lib/members/session";
import { planSettingsChange, type SettingsChangeSummary } from "./change-impact";
import { findPromise, type PromiseRow } from "./promise-state";
import type { SettingsError, StartSettingsInput } from "./start-settings";

// 재설정(STATE-API-03)과 재조율(STATE-API-06)이 함께 쓰는 반영 단계. 상태 전환은 부르는 쪽이 한다.
// 잠근 약속에 새 설정을 검증하고, 영향 계산(change-impact)대로 설정·슬롯·버전·제출 상태·세션을 한 번에 고친다.
// 호출하는 쪽이 lockPromise로 잠그고 권한·상태를 확인한 뒤 같은 트랜잭션에서 부른다.

export type { SettingsChangeSummary };

export type AppliedSettingsChange =
  | { ok: false; errors: SettingsError[] }
  | {
      ok: true;
      promise: PromiseRow;
      summary: SettingsChangeSummary;
      /** 마감이 바뀌어 세션을 늘렸으면 그 만료 시각 */
      sessionExpiresAt: Date | null;
    };

export async function applySettingsChange(
  tx: Prisma.TransactionClient,
  promise: PromiseRow,
  next: StartSettingsInput,
  options: {
    /** 재설정: 바꾸지 않은 기존 마감은 다시 검증하지 않는다. 재조율은 새 마감을 반드시 정하므로 넘기지 않는다. */
    keptVotingDeadline?: Date;
  } = {},
): Promise<AppliedSettingsChange> {
  const participants = await tx.participant.findMany({
    where: { promiseId: promise.id, status: "active" },
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
  };
  const impact = planSettingsChange({
    current,
    next,
    keptVotingDeadline: options.keptVotingDeadline,
    participants: participants.map((p) => ({
      participantId: p.id,
      slots: p.availableSlots.map((s) => s.slotStartAt.getTime()),
    })),
    now: promise.now,
  });
  if (!impact.ok) return { ok: false, errors: impact.errors };
  const { settings } = impact;

  await tx.promise.update({
    where: { id: promise.id },
    data: {
      title: settings.title,
      participantLimit: settings.participantLimit,
      dateRangeStart: new Date(`${settings.dateRangeStart}T00:00:00Z`),
      dateRangeEnd: new Date(`${settings.dateRangeEnd}T00:00:00Z`),
      votingDeadlineAt: settings.votingDeadlineAt,
      durationMinutes: settings.durationMinutes,
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

  // 마감이 바뀌면 유효한 세션을 새 마감 + 7일로 맞춘다. 만료된 세션은 되살리지 않는다.
  let sessionExpiresAt: Date | null = null;
  if (settings.votingDeadlineAt.getTime() !== promise.votingDeadlineAt!.getTime()) {
    sessionExpiresAt = afterDeadlineExpiresAt(settings.votingDeadlineAt);
    await extendActiveSessions(tx, promise.id, promise.now, sessionExpiresAt);
  }

  const updated = (await findPromise(tx, promise.id))!;
  const blocks = await loadCandidateBlocks(tx, updated);
  return {
    ok: true,
    promise: updated,
    sessionExpiresAt,
    summary: {
      rangeChanged:
        settings.dateRangeStart !== current.dateRangeStart ||
        settings.dateRangeEnd !== current.dateRangeEnd,
      hasAddedSelectableSlots: impact.rangeGrew,
      submissionsReset: impact.rangeGrew,
      removedSlotCount: impact.removedSlots.reduce((n, p) => n + p.slots.length, 0),
      removedSlotParticipantCount: impact.removedSlots.length,
      versionChangedParticipantCount: impact.versionBumped.length,
      submissionsResetParticipantCount: impact.rangeGrew
        ? participants.filter((p) => p.availabilitySubmittedAt !== null).length
        : 0,
      hasCandidates: blocks.some((b) => b.best !== null),
    },
  };
}

/** 422 응답 본문용: 첫 오류의 코드(정원 부족이면 CAPACITY_BELOW_ACTIVE_COUNT)와 전체 목록 */
export function settingsErrorBody(errors: SettingsError[]) {
  const [first] = errors;
  return {
    code: first.code ?? "VALIDATION_FAILED",
    message: first.message,
    details: { field: first.field, errors },
  };
}
