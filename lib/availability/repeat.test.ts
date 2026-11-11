import { describe, expect, it } from "vitest";
import { planRepeat, slotRanges, weeklyDates, type RepeatPlan } from "./repeat";
import type { SlotRange } from "./slots";

// 가능 시간 반복 적용(vote-ui-extras 01, Figma 10·11). DB·시계 없이 입력만으로 검증한다.

const at = (local: string) => Date.parse(`2026-${local}:00+09:00`);
const iso = (slots: number[]) => slots.map((ms) => new Date(ms).toISOString());
/** 비교하기 쉽게 날짜별 슬롯을 ISO 문자열로 */
const shape = (plan: RepeatPlan) => ({
  dates: plan.dates.map(({ date, slots }) => ({ date, slots: iso(slots) })),
  slots: iso(plan.slots),
});

// 날짜 범위 10-01~10-31, 하루 09:00~24:00
const RANGE: SlotRange = {
  dateRangeStart: "2026-10-01",
  dateRangeEnd: "2026-10-31",
  dailyStartMinute: 540,
  dailyEndMinute: 1440,
};
const NOW = at("10-05T12:00");

describe("planRepeat", () => {
  it("원본 날짜에 고른 시간을 대상 날짜의 같은 시각으로 복사한다", () => {
    const plan = planRepeat({
      selected: [at("10-06T18:00"), at("10-06T18:30"), at("10-08T19:00")],
      source: "2026-10-06",
      targets: ["2026-10-13", "2026-10-20"],
      range: RANGE,
      now: NOW,
    });
    expect(shape(plan)).toEqual({
      dates: [
        { date: "2026-10-13", slots: iso([at("10-13T18:00"), at("10-13T18:30")]) },
        { date: "2026-10-20", slots: iso([at("10-20T18:00"), at("10-20T18:30")]) },
      ],
      slots: iso([at("10-13T18:00"), at("10-13T18:30"), at("10-20T18:00"), at("10-20T18:30")]),
    });
  });

  it("원본 날짜·날짜 범위 밖·지난 슬롯은 빼고, 남는 시간이 없는 날짜도 뺀다", () => {
    const plan = planRepeat({
      selected: [at("10-06T11:30"), at("10-06T12:00"), at("10-06T12:30")],
      source: "2026-10-06",
      // 10-05 12:00이 현재: 10-03은 지난 날짜, 10-05는 11:30·12:00(시작 = 현재)이 지난 슬롯이다.
      targets: ["2026-09-29", "2026-10-03", "2026-10-05", "2026-10-06", "2026-11-03"],
      range: RANGE,
      now: NOW,
    });
    expect(shape(plan)).toEqual({
      dates: [{ date: "2026-10-05", slots: iso([at("10-05T12:30")]) }],
      slots: iso([at("10-05T12:30")]),
    });
  });

  it("이미 고른 시간은 다시 담지 않고, 새로 더할 시간이 없는 날짜는 뺀다", () => {
    const plan = planRepeat({
      selected: [
        at("10-06T18:00"),
        at("10-06T18:30"),
        at("10-13T18:00"),
        at("10-20T18:00"),
        at("10-20T18:30"),
      ],
      source: "2026-10-06",
      targets: ["2026-10-13", "2026-10-20"],
      range: RANGE,
      now: NOW,
    });
    expect(shape(plan)).toEqual({
      dates: [{ date: "2026-10-13", slots: iso([at("10-13T18:30")]) }],
      slots: iso([at("10-13T18:30")]),
    });
  });

  it("고른 순서와 상관없이 날짜순으로, 같은 날짜는 한 번만 담는다", () => {
    const plan = planRepeat({
      selected: [at("10-06T18:00")],
      source: "2026-10-06",
      targets: ["2026-10-20", "2026-10-13", "2026-10-20"],
      range: RANGE,
      now: NOW,
    });
    expect(plan.dates.map((d) => d.date)).toEqual(["2026-10-13", "2026-10-20"]);
    expect(iso(plan.slots)).toEqual(iso([at("10-13T18:00"), at("10-20T18:00")]));
  });
});

describe("slotRanges", () => {
  it("그 날짜에 고른 슬롯을 이어진 구간으로 묶는다", () => {
    const ranges = slotRanges(
      [at("10-06T20:00"), at("10-06T18:30"), at("10-06T18:00"), at("10-07T18:00")],
      "2026-10-06",
    );
    expect(ranges.map(({ start, end }) => iso([start, end]))).toEqual([
      iso([at("10-06T18:00"), at("10-06T19:00")]),
      iso([at("10-06T20:00"), at("10-06T20:30")]),
    ]);
  });
});

describe("weeklyDates", () => {
  it("원본 날짜 다음 날부터 종료일까지 고른 요일의 날짜를 돌려준다", () => {
    // 2026-10-06은 화요일(2)
    expect(weeklyDates("2026-10-06", [2], "2026-10-31")).toEqual([
      "2026-10-13",
      "2026-10-20",
      "2026-10-27",
    ]);
  });
});
