import { addDays, kstMidnight, MINUTE_MS, SLOT_MS } from "@/lib/time";

// 후보 계산 모듈(스펙 「모듈 › 후보 계산 모듈」). DB와 시계에 의존하지 않는 순수 함수다.
// 후보 조회(티켓 08)와 확정(티켓 09)이 같은 결과를 쓰도록 한 곳에 둔다.

/** 서로 겹치지 않게 골라 보여주는 후보 수(RESULT-07-01) */
const MAX_CANDIDATES = 5;
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

export type Candidate = {
  startAt: Date;
  /** 시작 + 약속 길이. 구간은 [startAt, endAt) */
  endAt: Date;
  /** 약속 길이 전체에 걸쳐 연속으로 가능한 참여자. 입력 순서를 따르지만, 쓰는 쪽은 순서에 기대지 않는다. */
  participantIds: string[];
};

/**
 * 서로 겹치지 않는 최대 5개 후보를 순위대로 돌려준다. 후보가 없으면 빈 배열.
 *
 * - 시작 시각은 30분 슬롯 경계이고, 구간 전체가 하루 시간 범위 안에 있어야 한다.
 *   자정을 넘는 후보는 하루 시간 범위가 00:00~24:00이라 날짜끼리 이어질 때만 생긴다(TIME-05-02).
 * - 약속 길이의 모든 슬롯이 가능한 참여자만 센다(RESULT-03-01). 2명 미만이면 후보가 아니다.
 * - 기준 시각(now)보다 이전에 시작하는 후보는 뺀다(TIME-08-02).
 * - 가능 인원 많은 순, 같으면 시작이 빠른 순으로 정렬한 뒤, 앞에서부터 고르며
 *   이미 고른 후보와 겹치면 건너뛴다(RESULT-06-01·02, RESULT-07-02).
 */
export function computeCandidates({
  settings,
  respondents,
  now,
}: {
  settings: CandidateSettings;
  respondents: Respondent[];
  now: Date;
}): Candidate[] {
  const durationMs = settings.durationMinutes * MINUTE_MS;
  const availability = respondents.map((r) => ({
    participantId: r.participantId,
    slots: new Set(r.slotStarts.map((d) => d.getTime())),
  }));

  const ranked: Candidate[] = [];
  for (const window of selectableWindows(settings)) {
    for (let start = window.start; start + durationMs <= window.end; start += SLOT_MS) {
      if (start < now.getTime()) continue;
      const participantIds = availability
        .filter(({ slots }) => coversWholeMeeting(slots, start, durationMs))
        .map(({ participantId }) => participantId);
      if (participantIds.length < MIN_PARTICIPANTS) continue;
      ranked.push({
        startAt: new Date(start),
        endAt: new Date(start + durationMs),
        participantIds,
      });
    }
  }
  ranked.sort(
    (a, b) =>
      b.participantIds.length - a.participantIds.length ||
      a.startAt.getTime() - b.startAt.getTime(),
  );

  const picked: Candidate[] = [];
  for (const candidate of ranked) {
    if (picked.length === MAX_CANDIDATES) break;
    if (picked.some((p) => overlaps(p, candidate))) continue;
    picked.push(candidate);
  }
  return picked;
}

/** 시작 슬롯부터 약속 길이 동안의 모든 슬롯이 가능한가 */
function coversWholeMeeting(slots: Set<number>, start: number, durationMs: number): boolean {
  for (let t = start; t < start + durationMs; t += SLOT_MS) {
    if (!slots.has(t)) return false;
  }
  return true;
}

/** 반열림 구간끼리 겹치는가. 끝과 시작이 맞닿은 것은 겹침이 아니다(TIME-07-01). */
function overlaps(a: Candidate, b: Candidate): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt;
}

/**
 * 날짜마다 [그날 00:00 + 시작 분, 그날 00:00 + 종료 분) 구간을 만들고, 끝과 시작이 맞닿은 구간은 잇는다.
 * 하루 시간 범위가 00:00~24:00일 때만 날짜끼리 이어져 자정을 넘는 후보가 생긴다.
 */
/** 후보를 만들 수 있는 반열림 구간 [start, end), epoch 밀리초 */
type Window = { start: number; end: number };

function selectableWindows(settings: CandidateSettings): Window[] {
  const windows: Window[] = [];
  for (let date = settings.dateRangeStart; date <= settings.dateRangeEnd; date = addDays(date, 1)) {
    const midnight = kstMidnight(date).getTime();
    const start = midnight + settings.dailyStartMinute * MINUTE_MS;
    const end = midnight + settings.dailyEndMinute * MINUTE_MS;
    const last = windows.at(-1);
    if (last && last.end === start) last.end = end;
    else windows.push({ start, end });
  }
  return windows;
}

/**
 * 확정된 시간 [startMs, startMs + 약속 길이)에 연속으로 가능한 참여자(입력 순서).
 * 확정 당시 목록은 저장하지 않고 현재 제출값으로 다시 계산한다. 2명 미만이 돼도 그대로 돌려준다(RESULT-13-02).
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
  return respondents
    .filter((r) =>
      coversWholeMeeting(new Set(r.slotStarts.map((d) => d.getTime())), startMs, durationMs),
    )
    .map((r) => r.participantId);
}
