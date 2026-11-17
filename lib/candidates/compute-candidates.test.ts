import { describe, expect, it } from "vitest";
import { SLOT_MS } from "@/lib/time";
import {
  attendeesFor,
  computeCandidateBlocks,
  pickWindow,
  type CandidateBlock,
  type CandidateSettings,
  type Respondent,
} from "./compute-candidates";

// 하루 단위 후보 계산(candidate-blocks 02, RESULT-01~07, TIME-08-02). 보조 seam: DB·시계 없이 입력만으로 검증한다.

const kst = (local: string) => new Date(`${local}:00+09:00`);

/** "12-01 14:00"~"12-01 16:00" 같은 반열림 구간들을 슬롯 시작 시각 목록으로 */
function slots(...ranges: [string, string][]): Date[] {
  return ranges.flatMap(([from, to]) => {
    const out: Date[] = [];
    for (let t = kst(`2026-${from}`).getTime(); t < kst(`2026-${to}`).getTime(); t += SLOT_MS) {
      out.push(new Date(t));
    }
    return out;
  });
}

const respondent = (participantId: string, ...ranges: [string, string][]): Respondent => ({
  participantId,
  slotStarts: slots(...ranges),
});

// 하루 시간 범위 09:00~24:00, 약속 길이 1시간, 날짜 범위 12-01~12-03
const SETTINGS: CandidateSettings = {
  dateRangeStart: "2026-12-01",
  dateRangeEnd: "2026-12-03",
  dailyStartMinute: 540,
  dailyEndMinute: 1440,
  durationMinutes: 60,
};
const NOW = kst("2026-11-30T12:00");

const at = (local: string) => kst(`2026-${local}`).toISOString();
/** 비교하기 쉽게: 블록 구간과 최적 창(시작·참여자) */
const shape = (blocks: CandidateBlock[]) =>
  blocks.map((b) => ({
    date: b.date,
    from: b.startAt.toISOString(),
    to: b.endAt.toISOString(),
    best: b.best && { start: b.best.startAt.toISOString(), ids: b.best.participantIds },
  }));

describe("하루 단위 후보 블록", () => {
  it("날짜마다 2명 이상 가능한 칸이 이어진 구간 하나가 블록이고, 약속 길이만큼 가장 많이 함께 가능한 창이 최적이다", () => {
    const result = computeCandidateBlocks({
      settings: SETTINGS,
      respondents: [
        respondent("a", ["12-01 14:00", "12-01 17:00"]),
        respondent("b", ["12-01 14:00", "12-01 16:00"]),
        respondent("c", ["12-01 15:00", "12-01 17:00"]),
      ],
      now: NOW,
    });

    // 14:00~17:00 모든 칸이 2명 이상. 15:00~16:00에는 3명이 함께 가능하다.
    expect(shape(result)).toEqual([
      {
        date: "2026-12-01",
        from: at("12-01 14:00"),
        to: at("12-01 17:00"),
        best: { start: at("12-01 15:00"), ids: ["a", "b", "c"] },
      },
    ]);
  });

  it("최적 창의 인원이 같으면 시작이 빠른 창이다", () => {
    const result = computeCandidateBlocks({
      settings: SETTINGS,
      respondents: [
        respondent("a", ["12-01 14:00", "12-01 17:00"]),
        respondent("b", ["12-01 14:00", "12-01 17:00"]),
      ],
      now: NOW,
    });

    expect(result[0].best?.startAt).toEqual(kst("2026-12-01T14:00"));
    expect(result[0].best?.endAt).toEqual(kst("2026-12-01T15:00"));
  });

  it("2명 미만인 칸에서 블록이 끊긴다", () => {
    const result = computeCandidateBlocks({
      settings: SETTINGS,
      respondents: [
        respondent("a", ["12-01 10:00", "12-01 11:00"], ["12-01 12:00", "12-01 13:00"]),
        respondent("b", ["12-01 10:00", "12-01 13:00"]),
      ],
      now: NOW,
    });

    expect(shape(result).map((b) => [b.from, b.to])).toEqual([
      [at("12-01 10:00"), at("12-01 11:00")],
      [at("12-01 12:00"), at("12-01 13:00")],
    ]);
  });

  describe("선택할 수 없는 블록", () => {
    it("약속 길이보다 짧은 블록은 최적 창이 없다(선택 불가로 보여준다)", () => {
      const result = computeCandidateBlocks({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 14:00", "12-01 14:30"]),
          respondent("b", ["12-01 14:00", "12-01 14:30"]),
        ],
        now: NOW,
      });

      expect(shape(result)).toEqual([
        { date: "2026-12-01", from: at("12-01 14:00"), to: at("12-01 14:30"), best: null },
      ]);
    });

    it("칸마다 2명이어도 약속 길이 내내 함께 가능한 사람이 2명 미만이면 최적 창이 없다", () => {
      const result = computeCandidateBlocks({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 14:00", "12-01 15:00"]),
          respondent("b", ["12-01 14:00", "12-01 14:30"]),
          respondent("c", ["12-01 14:30", "12-01 15:00"]),
        ],
        now: NOW,
      });

      expect(result).toHaveLength(1);
      expect(result[0].best).toBeNull();
    });
  });

  describe("범위와 지난 시각", () => {
    it("하루 시간 범위 밖과 날짜 범위 밖 칸은 블록에 들어가지 않는다", () => {
      const result = computeCandidateBlocks({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 08:00", "12-01 10:00"], ["12-04 10:00", "12-04 12:00"]),
          respondent("b", ["12-01 08:00", "12-01 10:00"], ["12-04 10:00", "12-04 12:00"]),
        ],
        now: NOW,
      });

      expect(shape(result).map((b) => [b.from, b.to])).toEqual([
        [at("12-01 09:00"), at("12-01 10:00")],
      ]);
    });

    it("하루 시간 범위가 00:00~24:00이어도 블록은 날짜를 넘지 않는다", () => {
      const result = computeCandidateBlocks({
        settings: { ...SETTINGS, dailyStartMinute: 0, dailyEndMinute: 1440 },
        respondents: [
          respondent("a", ["12-01 23:00", "12-02 01:00"]),
          respondent("b", ["12-01 23:00", "12-02 01:00"]),
        ],
        now: NOW,
      });

      expect(shape(result).map((b) => b.date)).toEqual(["2026-12-01", "2026-12-02"]);
    });

    it("기준 시각 전에 시작한 칸은 빼고, 기준 시각에 시작하는 칸부터 블록이 된다", () => {
      const result = computeCandidateBlocks({
        settings: { ...SETTINGS, durationMinutes: 30 },
        respondents: [
          respondent("a", ["12-01 14:00", "12-01 15:00"]),
          respondent("b", ["12-01 14:00", "12-01 15:00"]),
        ],
        now: kst("2026-12-01T14:30"),
      });

      expect(shape(result).map((b) => [b.from, b.best?.start])).toEqual([
        [at("12-01 14:30"), at("12-01 14:30")],
      ]);
    });
  });

  describe("정렬과 개수", () => {
    it("선택할 수 있는 블록이 먼저, 최적 인원이 많은 순, 같으면 빠른 순이고, 선택 불가 블록은 뒤에 빠른 순이다", () => {
      const result = computeCandidateBlocks({
        settings: SETTINGS,
        respondents: [
          respondent(
            "a",
            ["12-01 10:00", "12-01 10:30"],
            ["12-02 10:00", "12-02 11:00"],
            ["12-03 10:00", "12-03 11:00"],
          ),
          respondent(
            "b",
            ["12-01 10:00", "12-01 10:30"],
            ["12-02 10:00", "12-02 11:00"],
            ["12-03 10:00", "12-03 11:00"],
          ),
          respondent("c", ["12-03 10:00", "12-03 11:00"]),
        ],
        now: NOW,
      });

      expect(shape(result).map((b) => [b.date, b.best?.ids.length ?? 0])).toEqual([
        ["2026-12-03", 3],
        ["2026-12-02", 2],
        ["2026-12-01", 0],
      ]);
    });

    it("최대 5개 블록을 보여준다", () => {
      const days = [1, 2, 3, 4, 5, 6, 7].map((d): [string, string] => [
        `12-0${d} 10:00`,
        `12-0${d} 11:00`,
      ]);
      const result = computeCandidateBlocks({
        settings: { ...SETTINGS, dateRangeEnd: "2026-12-07" },
        respondents: [respondent("a", ...days), respondent("b", ...days)],
        now: NOW,
      });

      expect(shape(result).map((b) => b.date)).toEqual([
        "2026-12-01",
        "2026-12-02",
        "2026-12-03",
        "2026-12-04",
        "2026-12-05",
      ]);
    });
  });

  it("제출한 참여자가 없으면 블록도 없다", () => {
    expect(computeCandidateBlocks({ settings: SETTINGS, respondents: [], now: NOW })).toEqual([]);
  });
});

describe("블록 안에서 확정할 창 고르기", () => {
  const respondents = [
    respondent("a", ["12-01 14:00", "12-01 17:00"]),
    respondent("b", ["12-01 14:00", "12-01 16:00"]),
    respondent("c", ["12-01 15:00", "12-01 17:00"]),
  ];
  const blocks = computeCandidateBlocks({ settings: SETTINGS, respondents, now: NOW });
  const pick = (local: string) =>
    pickWindow({
      blocks,
      respondents,
      startMs: kst(`2026-${local}`).getTime(),
      durationMinutes: 60,
    });

  it("블록 안의 30분 경계 시작이고 약속 길이 내내 2명 이상이면 그 창을 돌려준다", () => {
    expect(pick("12-01T15:30")).toEqual({
      startAt: kst("2026-12-01T15:30"),
      endAt: kst("2026-12-01T16:30"),
      participantIds: ["a", "c"],
    });
  });

  it("창 끝이 블록을 넘거나, 블록 밖이거나, 30분 경계가 아니면 null", () => {
    expect(pick("12-01T16:30")).toBeNull();
    expect(pick("12-01T13:30")).toBeNull();
    expect(pick("12-01T14:15")).toBeNull();
  });

  it("블록 안이어도 약속 길이 내내 함께 가능한 사람이 2명 미만이면 null", () => {
    const thin = [
      respondent("a", ["12-01 14:00", "12-01 15:00"]),
      respondent("b", ["12-01 14:00", "12-01 14:30"]),
      respondent("c", ["12-01 14:30", "12-01 15:00"]),
    ];
    const thinBlocks = computeCandidateBlocks({ settings: SETTINGS, respondents: thin, now: NOW });
    expect(
      pickWindow({
        blocks: thinBlocks,
        respondents: thin,
        startMs: kst("2026-12-01T14:00").getTime(),
        durationMinutes: 60,
      }),
    ).toBeNull();
  });
});

describe("확정된 시간의 참석 가능한 참여자", () => {
  const start = kst("2026-12-01T14:00").getTime();

  it("약속 길이 전체에 연속으로 가능한 참여자만 돌려준다", () => {
    const ids = attendeesFor({
      startMs: start,
      durationMinutes: 60,
      respondents: [
        respondent("a", ["12-01 14:00", "12-01 15:00"]),
        respondent("b", ["12-01 14:00", "12-01 14:30"]),
        respondent("c", ["12-01 13:00", "12-01 16:00"]),
      ],
    });

    expect(ids).toEqual(["a", "c"]);
  });

  it("가능한 사람이 2명 미만이어도 그대로 돌려준다(확정은 유지된다, RESULT-13-02)", () => {
    const ids = attendeesFor({
      startMs: start,
      durationMinutes: 60,
      respondents: [respondent("a", ["12-01 14:00", "12-01 15:00"])],
    });

    expect(ids).toEqual(["a"]);
  });
});
