import { addDays, kstMidnight, MINUTE_MS, SLOT_MS } from "@/lib/time";

// 후보 계산 모듈(스펙 「모듈 › 후보 계산 모듈」). DB와 시계에 의존하지 않는 순수 함수다.
// 후보 조회와 확정이 같은 결과를 쓰도록 한 곳에 둔다.
//
// 하루 단위 후보(candidate-blocks 02, 2026-11-17 결정):
// - 날짜마다 2명 이상 가능한 30분 칸이 이어진 구간 하나가 후보 블록이다.
// - 블록마다 약속 길이만큼 연속으로 함께 가능한 사람이 가장 많은 창(같으면 빠른 창)이 최적 창이다.
//   그런 창이 없으면(블록이 약속 길이보다 짧거나, 내내 함께 가능한 사람이 2명 미만) 선택할 수 없는 블록이다.
// - 방장은 보여주는 블록 안에서 약속 길이 창의 시작을 골라 확정한다(pickWindow).

/** 보여주는 블록 수(RESULT-07-01) */
const MAX_BLOCKS = 5;
/** 후보가 되는 최소 가능 인원(RESULT-04-01) */
const MIN_PARTICIPANTS = 2;

export type CandidateSettings = {
  /** YYYY-MM-DD, 양 끝 포함 */
  dateRangeStart: string;
  dateRangeEnd: string;
  /** 한국 시각 자정부터의 분. 종료 1440은 24:00 */
  dailyStartMinute: number;
  dailyEndMinute: number;
  durationMinutes: number;
};

/** 제출을 마친 active 참여자의 가능 슬롯. 미제출·탈퇴자는 호출하는 쪽이 빼고 넘긴다(RESULT-01-01). */
export type Respondent = { participantId: string; slotStarts: Date[] };

/** 약속 길이만큼의 창 하나 */
export type Candidate = {
  startAt: Date;
  /** 시작 + 약속 길이. 구간은 [startAt, endAt) */
  endAt: Date;
  /** 약속 길이 전체에 걸쳐 연속으로 가능한 참여자(입력 순서) */
  participantIds: string[];
};

export type CandidateBlock = {
  /** 한국 날짜 YYYY-MM-DD */
  date: string;
  /** 2명 이상 가능한 칸이 이어진 구간 [startAt, endAt) */
  startAt: Date;
  endAt: Date;
  /** 최적 창. null이면 이 블록에서는 확정할 수 없다. */
  best: Candidate | null;
};

/**
 * 보여줄 후보 블록(최대 5개). 선택할 수 있는 블록이 먼저(최적 인원 많은 순, 같으면 빠른 순),
 * 선택할 수 없는 블록은 그 뒤에 빠른 순이다.
 *
 * - 칸은 하루 시간 범위·날짜 범위 안이고, 기준 시각(now) 이후에 시작해야 한다(TIME-08-02).
 * - 블록은 날짜를 넘지 않는다(하루 단위).
 * - 창의 인원은 약속 길이 전체에 연속으로 가능한 사람만 센다(RESULT-03-01).
 */
export function computeCandidateBlocks({
  settings,
  respondents,
  now,
}: {
  settings: CandidateSettings;
  respondents: Respondent[];
  now: Date;
}): CandidateBlock[] {
  const sets = toSets(respondents);
  const durationMs = settings.durationMinutes * MINUTE_MS;
  const blocks: CandidateBlock[] = [];

  for (let date = settings.dateRangeStart; date <= settings.dateRangeEnd; date = addDays(date, 1)) {
    const midnight = kstMidnight(date).getTime();
    const dayStart = midnight + settings.dailyStartMinute * MINUTE_MS;
    const dayEnd = midnight + settings.dailyEndMinute * MINUTE_MS;
    let runStart: number | null = null;
    for (let slot = dayStart; slot <= dayEnd; slot += SLOT_MS) {
      const open =
        slot < dayEnd &&
        slot >= now.getTime() &&
        sets.filter(({ slots }) => slots.has(slot)).length >= MIN_PARTICIPANTS;
      if (open && runStart === null) runStart = slot;
      if (!open && runStart !== null) {
        blocks.push({
          date,
          startAt: new Date(runStart),
          endAt: new Date(slot),
          best: bestWindow(sets, runStart, slot, durationMs),
        });
        runStart = null;
      }
    }
  }

  const count = (b: CandidateBlock) => b.best?.participantIds.length ?? 0;
  blocks.sort(
    (a, b) =>
      Number(b.best !== null) - Number(a.best !== null) ||
      count(b) - count(a) ||
      a.startAt.getTime() - b.startAt.getTime(),
  );
  return blocks.slice(0, MAX_BLOCKS);
}

/**
 * 방장이 고른 시작 시각의 창. 보여주는 블록 안의 30분 경계 시작이고, 창 끝이 블록을 넘지 않고,
 * 약속 길이 내내 함께 가능한 사람이 2명 이상이어야 한다. 아니면 null.
 */
export function pickWindow({
  blocks,
  respondents,
  startMs,
  durationMinutes,
}: {
  blocks: CandidateBlock[];
  respondents: Respondent[];
  startMs: number;
  durationMinutes: number;
}): Candidate | null {
  const endMs = startMs + durationMinutes * MINUTE_MS;
  const block = blocks.find(
    (b) =>
      b.best !== null &&
      startMs >= b.startAt.getTime() &&
      endMs <= b.endAt.getTime() &&
      (startMs - b.startAt.getTime()) % SLOT_MS === 0,
  );
  if (!block) return null;
  const participantIds = attendeesFor({ startMs, durationMinutes, respondents });
  if (participantIds.length < MIN_PARTICIPANTS) return null;
  return { startAt: new Date(startMs), endAt: new Date(endMs), participantIds };
}

/**
 * [startMs, startMs + 약속 길이)에 연속으로 가능한 참여자(입력 순서).
 * 확정된 일정의 참석자도 저장하지 않고 현재 제출값으로 다시 계산한다. 2명 미만이 돼도 그대로 돌려준다(RESULT-13-02).
 */
export function attendeesFor({
  startMs,
  durationMinutes,
  respondents,
}: {
  startMs: number;
  durationMinutes: number;
  respondents: Respondent[];
}): string[] {
  const durationMs = durationMinutes * MINUTE_MS;
  return toSets(respondents)
    .filter(({ slots }) => coversWholeMeeting(slots, startMs, durationMs))
    .map(({ participantId }) => participantId);
}

type RespondentSet = { participantId: string; slots: Set<number> };

function toSets(respondents: Respondent[]): RespondentSet[] {
  return respondents.map((r) => ({
    participantId: r.participantId,
    slots: new Set(r.slotStarts.map((d) => d.getTime())),
  }));
}

/** 블록 [from, to) 안에서 함께 가능한 사람이 가장 많은 창(같으면 빠른 창). 2명 이상인 창이 없으면 null */
function bestWindow(
  sets: RespondentSet[],
  from: number,
  to: number,
  durationMs: number,
): Candidate | null {
  let best: Candidate | null = null;
  for (let start = from; start + durationMs <= to; start += SLOT_MS) {
    const participantIds = sets
      .filter(({ slots }) => coversWholeMeeting(slots, start, durationMs))
      .map(({ participantId }) => participantId);
    if (participantIds.length < MIN_PARTICIPANTS) continue;
    if (!best || participantIds.length > best.participantIds.length) {
      best = { startAt: new Date(start), endAt: new Date(start + durationMs), participantIds };
    }
  }
  return best;
}

/** 시작 슬롯부터 약속 길이 동안의 모든 슬롯이 가능한가 */
function coversWholeMeeting(slots: Set<number>, start: number, durationMs: number): boolean {
  for (let t = start; t < start + durationMs; t += SLOT_MS) {
    if (!slots.has(t)) return false;
  }
  return true;
}
