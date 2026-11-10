import { describe, expect, it } from "vitest";
import { SLOT_MS } from "@/lib/time";
import { computeCandidates, type CandidateSettings, type Respondent } from "./compute-candidates";

// 후보 계산(RESULT-01~07, TIME-05-02·07-01·08-02). 보조 seam: DB·시계 없이 입력만으로 검증한다.

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

const starts = (candidates: { startAt: Date }[]) => candidates.map((c) => c.startAt.toISOString());
const at = (local: string) => kst(`2026-${local}`).toISOString();

describe("후보 계산", () => {
  it("후보는 약속 길이만큼의 반열림 구간이고, 참석 가능한 참여자를 함께 돌려준다", () => {
    const result = computeCandidates({
      settings: SETTINGS,
      respondents: [
        respondent("a", ["12-01 14:00", "12-01 15:00"]),
        respondent("b", ["12-01 14:00", "12-01 15:00"]),
      ],
      now: NOW,
    });

    expect(result).toEqual([
      {
        startAt: kst("2026-12-01T14:00"),
        endAt: kst("2026-12-01T15:00"),
        participantIds: ["a", "b"],
      },
    ]);
  });

  it("후보 시작 시각은 30분 슬롯 경계다", () => {
    const result = computeCandidates({
      settings: { ...SETTINGS, durationMinutes: 30 },
      respondents: [
        respondent("a", ["12-01 14:30", "12-01 15:00"]),
        respondent("b", ["12-01 14:30", "12-01 15:00"]),
      ],
      now: NOW,
    });

    expect(starts(result)).toEqual([at("12-01 14:30")]);
  });

  describe("연속으로 가능한 참여자만 센다", () => {
    it("약속 길이 중 한 슬롯이라도 빠진 참여자는 그 후보의 가능 인원이 아니다", () => {
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 14:00", "12-01 15:00"]),
          respondent("b", ["12-01 14:00", "12-01 15:00"]),
          respondent("c", ["12-01 14:00", "12-01 14:30"]), // 14:30 슬롯이 없다
        ],
        now: NOW,
      });

      expect(result[0].participantIds).toEqual(["a", "b"]);
    });

    it("슬롯마다 2명이 가능해도 구간 전체에 함께 가능한 참여자가 1명이면 후보가 아니다", () => {
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 14:00", "12-01 15:00"]),
          respondent("b", ["12-01 14:00", "12-01 14:30"]),
          respondent("c", ["12-01 14:30", "12-01 15:00"]),
        ],
        now: NOW,
      });

      expect(result).toEqual([]);
    });
  });

  describe("하루 시간 범위", () => {
    it("구간 끝이 하루 시간 범위를 넘는 후보는 없다(23:30 시작 1시간은 24:00을 넘는다)", () => {
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 23:00", "12-02 01:00"]),
          respondent("b", ["12-01 23:00", "12-02 01:00"]),
        ],
        now: NOW,
      });

      expect(starts(result)).toEqual([at("12-01 23:00")]);
    });

    it("구간 시작이 하루 시간 범위보다 앞인 후보는 없다", () => {
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 08:00", "12-01 10:00"]),
          respondent("b", ["12-01 08:00", "12-01 10:00"]),
        ],
        now: NOW,
      });

      expect(starts(result)).toEqual([at("12-01 09:00")]);
    });

    it("하루 시간 범위가 00:00~24:00이면 자정을 넘는 후보가 생긴다", () => {
      const result = computeCandidates({
        settings: { ...SETTINGS, dailyStartMinute: 0, dailyEndMinute: 1440 },
        respondents: [
          respondent("a", ["12-01 23:30", "12-02 00:30"]),
          respondent("b", ["12-01 23:30", "12-02 00:30"]),
        ],
        now: NOW,
      });

      expect(result).toEqual([
        {
          startAt: kst("2026-12-01T23:30"),
          endAt: kst("2026-12-02T00:30"),
          participantIds: ["a", "b"],
        },
      ]);
    });

    it("날짜 범위 마지막 날 24:00을 넘는 후보는 없다", () => {
      const result = computeCandidates({
        settings: { ...SETTINGS, dailyStartMinute: 0, dailyEndMinute: 1440 },
        respondents: [
          respondent("a", ["12-03 23:30", "12-04 00:30"]),
          respondent("b", ["12-03 23:30", "12-04 00:30"]),
        ],
        now: NOW,
      });

      expect(result).toEqual([]);
    });

    it("날짜 범위 밖의 슬롯은 후보가 되지 않는다", () => {
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["11-30 14:00", "11-30 15:00"]),
          respondent("b", ["11-30 14:00", "11-30 15:00"]),
        ],
        now: kst("2026-11-29T12:00"),
      });

      expect(result).toEqual([]);
    });
  });

  describe("2명 미만과 지난 시각", () => {
    it("가능 인원이 1명인 시각은 후보가 아니다", () => {
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [respondent("a", ["12-01 14:00", "12-01 15:00"])],
        now: NOW,
      });

      expect(result).toEqual([]);
    });

    it("기준 시각보다 이전에 시작하는 후보는 없고, 기준 시각에 시작하는 후보는 있다", () => {
      const result = computeCandidates({
        settings: { ...SETTINGS, durationMinutes: 30 },
        respondents: [
          respondent("a", ["12-01 14:00", "12-01 15:00"]),
          respondent("b", ["12-01 14:00", "12-01 15:00"]),
        ],
        now: kst("2026-12-01T14:30"),
      });

      expect(starts(result)).toEqual([at("12-01 14:30")]);
    });
  });

  describe("정렬과 고르기", () => {
    it("가능 인원이 많은 후보가 먼저, 같으면 시작이 빠른 후보가 먼저다", () => {
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [
          respondent(
            "a",
            ["12-01 10:00", "12-01 11:00"],
            ["12-02 10:00", "12-02 11:00"],
            ["12-03 10:00", "12-03 11:00"],
          ),
          respondent(
            "b",
            ["12-01 10:00", "12-01 11:00"],
            ["12-02 10:00", "12-02 11:00"],
            ["12-03 10:00", "12-03 11:00"],
          ),
          respondent("c", ["12-03 10:00", "12-03 11:00"]),
        ],
        now: NOW,
      });

      expect(starts(result)).toEqual([at("12-03 10:00"), at("12-01 10:00"), at("12-02 10:00")]);
    });

    it("같은 날 가능 인원이 같으면 시작이 빠른 후보가 먼저다(RESULT-06-02 예시)", () => {
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 14:00", "12-01 15:00"], ["12-01 16:00", "12-01 17:00"]),
          respondent("b", ["12-01 16:00", "12-01 17:00"], ["12-01 14:00", "12-01 15:00"]),
        ],
        now: NOW,
      });

      expect(starts(result)).toEqual([at("12-01 14:00"), at("12-01 16:00")]);
    });

    it("이미 고른 후보와 겹치는 후보는 건너뛴다(RESULT-07-02 예시)", () => {
      // 14:00(3명), 14:30(3명), 17:00(2명), 약속 길이 1시간 → 14:00, 17:00
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 14:00", "12-01 15:30"], ["12-01 17:00", "12-01 18:00"]),
          respondent("b", ["12-01 14:00", "12-01 15:30"], ["12-01 17:00", "12-01 18:00"]),
          respondent("c", ["12-01 14:00", "12-01 15:30"]),
        ],
        now: NOW,
      });

      expect(starts(result)).toEqual([at("12-01 14:00"), at("12-01 17:00")]);
    });

    it("끝과 시작이 맞닿은 후보는 겹치지 않는다(반열림 구간)", () => {
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 14:00", "12-01 16:00"]),
          respondent("b", ["12-01 14:00", "12-01 16:00"]),
        ],
        now: NOW,
      });

      expect(starts(result)).toEqual([at("12-01 14:00"), at("12-01 15:00")]);
    });

    it("서로 겹치지 않는 후보를 최대 5개까지 고른다", () => {
      const result = computeCandidates({
        settings: SETTINGS,
        respondents: [
          respondent("a", ["12-01 09:00", "12-02 00:00"]),
          respondent("b", ["12-01 09:00", "12-02 00:00"]),
        ],
        now: NOW,
      });

      expect(starts(result)).toEqual([
        at("12-01 09:00"),
        at("12-01 10:00"),
        at("12-01 11:00"),
        at("12-01 12:00"),
        at("12-01 13:00"),
      ]);
    });
  });

  it("제출한 참여자가 없으면 후보도 없다", () => {
    expect(computeCandidates({ settings: SETTINGS, respondents: [], now: NOW })).toEqual([]);
  });

  it("가능 슬롯이 하나도 없는 제출은 어느 후보에도 들어가지 않는다", () => {
    const result = computeCandidates({
      settings: SETTINGS,
      respondents: [
        respondent("a", ["12-01 14:00", "12-01 15:00"]),
        respondent("b", ["12-01 14:00", "12-01 15:00"]),
        { participantId: "empty", slotStarts: [] },
      ],
      now: NOW,
    });

    expect(result[0].participantIds).toEqual(["a", "b"]);
  });
});
