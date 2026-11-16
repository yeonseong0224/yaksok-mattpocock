import { describe, expect, it } from "vitest";
import { applyDayRanges, dayMinuteRanges, dayRangesError } from "./day-edit";
import type { SlotRange } from "./slots";

// 모바일 날짜별 시간 수정 시트(모바일 시간표 개편). 그날의 선택을 시작·종료 시간 구간으로 바꿔 쓴다.

const at = (local: string) => Date.parse(`2026-${local}:00+09:00`);
const iso = (slots: Iterable<number>) =>
  [...slots].sort((a, b) => a - b).map((ms) => new Date(ms).toISOString());

// 날짜 범위 10-01~10-31, 하루 09:00~24:00
const RANGE: SlotRange = {
  dateRangeStart: "2026-10-01",
  dateRangeEnd: "2026-10-31",
  dailyStartMinute: 540,
  dailyEndMinute: 1440,
};
const NOW = at("10-05T12:00");

describe("dayMinuteRanges", () => {
  it("그날 고른 슬롯을 이어진 분 구간으로 묶는다(다른 날짜는 무시)", () => {
    const selected = [
      at("10-06T18:00"),
      at("10-06T18:30"),
      at("10-06T21:00"),
      at("10-06T23:30"),
      at("10-07T18:00"),
    ];
    expect(dayMinuteRanges(selected, "2026-10-06")).toEqual([
      { start: 1080, end: 1140 },
      { start: 1260, end: 1290 },
      { start: 1410, end: 1440 },
    ]);
  });

  it("고른 시간이 없으면 빈 목록", () => {
    expect(dayMinuteRanges([at("10-07T18:00")], "2026-10-06")).toEqual([]);
  });
});

describe("dayRangesError", () => {
  it("종료가 시작보다 늦지 않은 구간이 있으면 알린다", () => {
    expect(dayRangesError([{ start: 600, end: 600 }])).toBe(
      "종료 시간은 시작 시간보다 늦어야 해요.",
    );
    expect(dayRangesError([{ start: 660, end: 600 }])).not.toBeNull();
  });

  it("올바른 구간뿐이거나 비어 있으면 null", () => {
    expect(dayRangesError([{ start: 600, end: 660 }])).toBeNull();
    expect(dayRangesError([])).toBeNull();
  });
});

describe("applyDayRanges", () => {
  it("그날의 선택을 구간으로 바꿔 쓰고, 다른 날짜의 선택은 그대로 둔다", () => {
    const next = applyDayRanges({
      selected: [at("10-06T18:00"), at("10-07T18:00")],
      date: "2026-10-06",
      ranges: [{ start: 600, end: 690 }],
      range: RANGE,
      now: NOW,
    });
    expect(iso(next)).toEqual(
      iso([at("10-06T10:00"), at("10-06T10:30"), at("10-06T11:00"), at("10-07T18:00")]),
    );
  });

  it("겹치는 구간은 한 번만 더한다", () => {
    const next = applyDayRanges({
      selected: [],
      date: "2026-10-06",
      ranges: [
        { start: 600, end: 690 },
        { start: 630, end: 720 },
      ],
      range: RANGE,
      now: NOW,
    });
    expect(iso(next)).toEqual(
      iso([at("10-06T10:00"), at("10-06T10:30"), at("10-06T11:00"), at("10-06T11:30")]),
    );
  });

  it("구간을 모두 지우면 그날의 선택이 비워진다", () => {
    const next = applyDayRanges({
      selected: [at("10-06T18:00"), at("10-06T18:30")],
      date: "2026-10-06",
      ranges: [],
      range: RANGE,
      now: NOW,
    });
    expect(iso(next)).toEqual([]);
  });

  it("지난 슬롯은 더하지도 빼지도 않는다(TIME-08-01)", () => {
    const next = applyDayRanges({
      selected: [at("10-05T10:00"), at("10-05T13:00")],
      date: "2026-10-05",
      ranges: [{ start: 660, end: 780 }], // 11:00~13:00, 11:00·11:30은 지난 시간
      range: RANGE,
      now: NOW,
    });
    expect(iso(next)).toEqual(iso([at("10-05T10:00"), at("10-05T12:30")]));
  });

  it("하루 시간 범위 밖의 슬롯은 더하지 않는다", () => {
    const next = applyDayRanges({
      selected: [],
      date: "2026-10-06",
      ranges: [{ start: 480, end: 600 }], // 08:00~10:00, 하루 시작은 09:00
      range: RANGE,
      now: NOW,
    });
    expect(iso(next)).toEqual(iso([at("10-06T09:00"), at("10-06T09:30")]));
  });

  it("날짜 범위 밖의 날짜는 바꾸지 않는다", () => {
    const next = applyDayRanges({
      selected: [],
      date: "2026-11-01",
      ranges: [{ start: 600, end: 660 }],
      range: RANGE,
      now: NOW,
    });
    expect(iso(next)).toEqual([]);
  });
});
