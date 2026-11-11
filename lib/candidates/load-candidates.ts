import type { Db } from "@/lib/prisma";
import type { PromiseRow } from "@/lib/promises/promise-state";
import { MINUTE_MS, toKstIso } from "@/lib/time";
import { attendeesFor, computeCandidates, type Respondent } from "./compute-candidates";

// 후보 조회(티켓 08), 확정 재검증과 확정 결과(티켓 09)가 함께 쓰는 DB 읽기.
// 제출을 마친 active 참여자만 계산에 넣는다(RESULT-01-01). 미제출·탈퇴자는 빠진다.

export type NamedParticipant = { participantId: string; nickname: string };

/** 시작·끝과 그 구간에 연속으로 가능한 참여자. 후보와 확정된 일정이 같은 모양이다. */
export type ScheduledTime = {
  startAt: Date;
  endAt: Date;
  participants: NamedParticipant[];
};

async function loadRespondents(db: Db, promiseId: string) {
  const rows = await db.participant.findMany({
    where: { promiseId, status: "active", availabilitySubmittedAt: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, nickname: true, availableSlots: { select: { slotStartAt: true } } },
  });
  const respondents: Respondent[] = rows.map((r) => ({
    participantId: r.id,
    slotStarts: r.availableSlots.map((s) => s.slotStartAt),
  }));
  const nicknames = new Map(rows.map((r) => [r.id, r.nickname]));
  const named = (ids: string[]): NamedParticipant[] =>
    ids.map((id) => ({ participantId: id, nickname: nicknames.get(id)! }));
  return { respondents, named };
}

/** 약속의 현재 후보(서로 겹치지 않는 최대 5개). 기준 시각은 약속 행을 읽은 DB 시각(promise.now)이다. */
export async function loadCandidates(db: Db, promise: PromiseRow): Promise<ScheduledTime[]> {
  const { respondents, named } = await loadRespondents(db, promise.id);
  const candidates = computeCandidates({
    settings: {
      dateRangeStart: promise.dateRangeStart!,
      dateRangeEnd: promise.dateRangeEnd!,
      dailyStartMinute: promise.dailyStartMinute!,
      dailyEndMinute: promise.dailyEndMinute!,
      durationMinutes: promise.durationMinutes!,
    },
    respondents,
    now: promise.now,
  });
  return candidates.map((c) => ({
    startAt: c.startAt,
    endAt: c.endAt,
    participants: named(c.participantIds),
  }));
}

/**
 * 확정된 일정. 끝 시각은 시작 + 약속 길이로 계산하고(RESULT-13-01),
 * 참석 가능한 사람은 저장하지 않고 현재 제출값으로 다시 계산한다(RESULT-13-02).
 */
export async function loadConfirmation(db: Db, promise: PromiseRow): Promise<ScheduledTime | null> {
  if (!promise.confirmedStartAt) return null;
  const { respondents, named } = await loadRespondents(db, promise.id);
  const startMs = promise.confirmedStartAt.getTime();
  const durationMinutes = promise.durationMinutes!;
  return {
    startAt: promise.confirmedStartAt,
    endAt: new Date(startMs + durationMinutes * MINUTE_MS),
    participants: named(attendeesFor({ startMs, durationMinutes, respondents })),
  };
}

/** API 응답용 일정 표기(후보 하나, 또는 확정된 일정) */
export function scheduledTimeJson(c: ScheduledTime) {
  return {
    startAt: toKstIso(c.startAt),
    endAt: toKstIso(c.endAt),
    availableParticipantCount: c.participants.length,
    participants: c.participants,
  };
}
