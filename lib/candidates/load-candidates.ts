import type { Db } from "@/lib/prisma";
import type { PromiseRow } from "@/lib/promises/promise-state";
import { MINUTE_MS, toKstIso } from "@/lib/time";
import {
  attendeesFor,
  computeCandidateBlocks,
  pickWindow,
  type Candidate,
  type CandidateSettings,
  type Respondent,
} from "./compute-candidates";

// 후보 조회, 확정 재검증과 확정 결과가 함께 쓰는 DB 읽기.
// active 참여자의 저장된 슬롯을 계산에 넣는다. 슬롯은 제출해야만 저장되므로 한 번도 제출하지 않은 사람은
// 슬롯이 없어 빠진다(RESULT-01-01). 범위 확대로 제출 상태가 풀린 사람의 남은 슬롯은 계속 들어간다(X-07). 탈퇴자는 빠진다.

export type NamedParticipant = { participantId: string; nickname: string };

/** 시작·끝과 그 구간에 연속으로 가능한 참여자. 최적 창, 확정할 창, 확정된 일정이 같은 모양이다. */
export type ScheduledTime = {
  startAt: Date;
  endAt: Date;
  participants: NamedParticipant[];
};

/** 하루 단위 후보 블록(candidate-blocks 02). best가 null이면 확정할 수 없는 블록이다. */
export type NamedBlock = {
  date: string;
  startAt: Date;
  endAt: Date;
  best: ScheduledTime | null;
};

async function loadRespondents(db: Db, promiseId: string) {
  const rows = await db.participant.findMany({
    where: { promiseId, status: "active" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, nickname: true, availableSlots: { select: { slotStartAt: true } } },
  });
  const respondents: Respondent[] = rows.map((r) => ({
    participantId: r.id,
    slotStarts: r.availableSlots.map((s) => s.slotStartAt),
  }));
  const nicknames = new Map(rows.map((r) => [r.id, r.nickname]));
  const named = (c: Candidate): ScheduledTime => ({
    startAt: c.startAt,
    endAt: c.endAt,
    participants: c.participantIds.map((id) => ({
      participantId: id,
      nickname: nicknames.get(id)!,
    })),
  });
  return { respondents, named };
}

function settingsOf(promise: PromiseRow): CandidateSettings {
  return {
    dateRangeStart: promise.dateRangeStart!,
    dateRangeEnd: promise.dateRangeEnd!,
    dailyStartMinute: promise.dailyStartMinute!,
    dailyEndMinute: promise.dailyEndMinute!,
    durationMinutes: promise.durationMinutes!,
  };
}

/** 약속의 현재 후보 블록(최대 5개). 기준 시각은 약속 행을 읽은 DB 시각(promise.now)이다. */
export async function loadCandidateBlocks(db: Db, promise: PromiseRow): Promise<NamedBlock[]> {
  const { respondents, named } = await loadRespondents(db, promise.id);
  const blocks = computeCandidateBlocks({
    settings: settingsOf(promise),
    respondents,
    now: promise.now,
  });
  return blocks.map((b) => ({ ...b, best: b.best && named(b.best) }));
}

/**
 * 확정 재검증: 지금 다시 계산한 블록 안에서 startMs로 시작하는 창. 확정할 수 없으면 picked가 null이고,
 * 새 블록 목록을 함께 돌려준다(409 응답에 싣는다).
 */
export async function loadPickedWindow(
  db: Db,
  promise: PromiseRow,
  startMs: number,
): Promise<{ picked: ScheduledTime | null; blocks: NamedBlock[] }> {
  const { respondents, named } = await loadRespondents(db, promise.id);
  const blocks = computeCandidateBlocks({
    settings: settingsOf(promise),
    respondents,
    now: promise.now,
  });
  const picked = pickWindow({
    blocks,
    respondents,
    startMs,
    durationMinutes: promise.durationMinutes!,
  });
  return {
    picked: picked && named(picked),
    blocks: blocks.map((b) => ({ ...b, best: b.best && named(b.best) })),
  };
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
  return named({
    startAt: promise.confirmedStartAt,
    endAt: new Date(startMs + durationMinutes * MINUTE_MS),
    participantIds: attendeesFor({ startMs, durationMinutes, respondents }),
  });
}

/** API 응답용 일정 표기(최적 창, 확정할 창, 또는 확정된 일정) */
export function scheduledTimeJson(c: ScheduledTime) {
  return {
    startAt: toKstIso(c.startAt),
    endAt: toKstIso(c.endAt),
    availableParticipantCount: c.participants.length,
    participants: c.participants,
  };
}

/** API 응답용 후보 블록 표기 */
export function candidateBlockJson(b: NamedBlock) {
  return {
    date: b.date,
    startAt: toKstIso(b.startAt),
    endAt: toKstIso(b.endAt),
    selectable: b.best !== null,
    best: b.best && scheduledTimeJson(b.best),
  };
}
