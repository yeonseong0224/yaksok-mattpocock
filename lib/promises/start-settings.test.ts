import { describe, expect, it } from "vitest";
import {
  defaultVotingDeadline,
  validateStartSettings,
  type StartSettingsInput,
} from "./start-settings";

// 모집 시작 설정 검증(STATE-03-01, TIME-03-01·04-01~03·13-01·14-01/02).
// 판정 시각(now)을 인자로 받으므로 23:45 같은 경계를 고정해 검증한다.

const kst = (iso: string) => new Date(`${iso}+09:00`);

// 2026-11-10 15:00 KST 기준
const NOW = kst("2026-11-10T15:00:00");

function input(overrides: Partial<StartSettingsInput> = {}): StartSettingsInput {
  return {
    title: "팀 저녁 모임",
    participantLimit: 4,
    dateRange: { startDate: "2026-11-12", endDate: "2026-11-20" },
    votingDeadlineAt: "2026-11-11T15:00:00+09:00",
    ...overrides,
  };
}

function fieldsOf(result: ReturnType<typeof validateStartSettings>) {
  return result.ok ? [] : result.errors.map((e) => e.field);
}

describe("모집 시작 설정 검증", () => {
  it("올바른 설정은 하루 시간 범위 09:00~24:00, 약속 길이 2시간과 함께 통과한다", () => {
    const result = validateStartSettings(input({ title: "  팀 저녁 모임  " }), NOW);

    expect(result).toEqual({
      ok: true,
      settings: {
        title: "팀 저녁 모임",
        participantLimit: 4,
        dateRangeStart: "2026-11-12",
        dateRangeEnd: "2026-11-20",
        dailyStartMinute: 540,
        dailyEndMinute: 1440,
        durationMinutes: 120,
        votingDeadlineAt: kst("2026-11-11T15:00:00"),
      },
    });
  });

  describe("약속 이름", () => {
    it.each([
      ["30자", "가".repeat(30), true],
      ["이모지 30개(화면 기준 30자)", "👨‍👩‍👧".repeat(30), true],
      ["31자", "가".repeat(31), false],
      ["공백뿐", "   ", false],
    ])("%s → 통과 %s", (_name, title, ok) => {
      expect(fieldsOf(validateStartSettings(input({ title }), NOW))).toEqual(ok ? [] : ["title"]);
    });
  });

  describe("정원", () => {
    it.each([
      [2, true],
      [30, true],
      [1, false],
      [31, false],
      [2.5, false],
    ])("%d명 → 통과 %s", (participantLimit, ok) => {
      expect(fieldsOf(validateStartSettings(input({ participantLimit }), NOW))).toEqual(
        ok ? [] : ["participantLimit"],
      );
    });
  });

  describe("날짜 범위", () => {
    it.each([
      ["미래 시작일에서 89일(양 끝 포함 89일)", "2027-03-01", "2027-05-28", true],
      ["미래 시작일에서 90일(종료일 = 시작일 + 89일)", "2027-03-01", "2027-05-29", true],
      ["미래 시작일에서 91일", "2027-03-01", "2027-05-30", false],
      ["오늘부터 시작", "2026-11-10", "2026-11-12", true],
      ["어제부터 시작", "2026-11-09", "2026-11-12", false],
      ["종료일이 시작일보다 앞", "2026-11-15", "2026-11-14", false],
      ["없는 날짜", "2026-11-12", "2026-11-31", false],
    ])("%s → 통과 %s", (_name, startDate, endDate, ok) => {
      const result = validateStartSettings(
        input({ dateRange: { startDate, endDate }, votingDeadlineAt: "2026-11-11T15:00:00+09:00" }),
        NOW,
      );
      expect(fieldsOf(result)).toEqual(ok ? [] : ["dateRange"]);
    });

    it("오늘 하루만 범위로 고를 수 없다(마지막 날 00:00이 이미 지났다)", () => {
      const result = validateStartSettings(
        input({ dateRange: { startDate: "2026-11-10", endDate: "2026-11-10" } }),
        NOW,
      );
      expect(fieldsOf(result)).toContain("dateRange");
    });

    it("23:45에는 내일을 종료일로 고를 수 없다", () => {
      const lateNight = kst("2026-11-10T23:45:00");
      const result = validateStartSettings(
        input({
          dateRange: { startDate: "2026-11-10", endDate: "2026-11-11" },
          votingDeadlineAt: "2026-11-11T00:00:00+09:00",
        }),
        lateNight,
      );
      expect(fieldsOf(result)).toContain("dateRange");
    });

    it("23:00에는 내일을 종료일로 고를 수 있다(마감 23:30이 남아 있다)", () => {
      const at2300 = kst("2026-11-10T23:00:00");
      const result = validateStartSettings(
        input({
          dateRange: { startDate: "2026-11-10", endDate: "2026-11-11" },
          votingDeadlineAt: "2026-11-10T23:30:00+09:00",
        }),
        at2300,
      );
      expect(result.ok).toBe(true);
    });

    it("23:00이 지나면 내일을 종료일로 고를 수 없다(고를 수 있는 마감이 없다)", () => {
      const at2310 = kst("2026-11-10T23:10:00");
      const result = validateStartSettings(
        input({
          dateRange: { startDate: "2026-11-10", endDate: "2026-11-11" },
          votingDeadlineAt: "2026-11-10T23:30:00+09:00",
        }),
        at2310,
      );
      expect(fieldsOf(result)).toContain("dateRange");
    });
  });

  describe("마감", () => {
    it.each([
      ["지금 + 30분", "2026-11-10T15:30:00+09:00", true],
      ["지금과 같은 시각", "2026-11-10T15:00:00+09:00", false],
      [
        "지금 + 29분이 되는 30분 경계는 없다: 15:00 기준 15:29는 단위 위반",
        "2026-11-10T15:29:00+09:00",
        false,
      ],
      ["마지막 날 00:00 직전 30분 경계", "2026-11-19T23:30:00+09:00", true],
      ["마지막 날 00:00", "2026-11-20T00:00:00+09:00", false],
      ["30분 단위가 아님", "2026-11-11T15:10:00+09:00", false],
      ["오프셋 없음", "2026-11-11T15:00:00", false],
      ["날짜 형식 아님", "내일", false],
    ])("%s → 통과 %s", (_name, votingDeadlineAt, ok) => {
      expect(fieldsOf(validateStartSettings(input({ votingDeadlineAt }), NOW))).toEqual(
        ok ? [] : ["votingDeadlineAt"],
      );
    });

    it("다른 오프셋으로 보낸 같은 시각도 받는다", () => {
      const result = validateStartSettings(
        input({ votingDeadlineAt: "2026-11-11T06:00:00.000Z" }),
        NOW,
      );
      expect(result.ok && result.settings.votingDeadlineAt).toEqual(kst("2026-11-11T15:00:00"));
    });
  });

  it("어긋난 필드를 모두 알려준다", () => {
    const result = validateStartSettings(
      input({ title: "", participantLimit: 99, votingDeadlineAt: "2026-11-10T15:00:00+09:00" }),
      NOW,
    );
    expect(fieldsOf(result)).toEqual(["title", "participantLimit", "votingDeadlineAt"]);
  });
});

describe("마감 기본값", () => {
  it("지금 + 24시간을 30분 단위로 올린다", () => {
    expect(defaultVotingDeadline(kst("2026-11-10T15:10:00"), "2026-11-20")).toEqual(
      kst("2026-11-11T15:30:00"),
    );
  });

  it("이미 30분 경계면 그대로 둔다", () => {
    expect(defaultVotingDeadline(kst("2026-11-10T15:00:00"), "2026-11-20")).toEqual(
      kst("2026-11-11T15:00:00"),
    );
  });

  it("마지막 날 00:00 이후가 되면 그 직전 30분 경계로 맞춘다", () => {
    expect(defaultVotingDeadline(kst("2026-11-10T15:10:00"), "2026-11-11")).toEqual(
      kst("2026-11-10T23:30:00"),
    );
  });

  it("맞춘 기본값은 모집 시작 검증을 통과한다", () => {
    const now = kst("2026-11-10T15:10:00");
    const deadline = defaultVotingDeadline(now, "2026-11-11");
    const result = validateStartSettings(
      input({
        dateRange: { startDate: "2026-11-10", endDate: "2026-11-11" },
        votingDeadlineAt: deadline.toISOString(),
      }),
      now,
    );
    expect(result.ok).toBe(true);
  });
});
