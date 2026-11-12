import { describe, expect, it } from "vitest";
import { planSettingsChange, type ChangeImpactInput } from "./change-impact";

// 설정 변경 영향 계산(재설정·재조율 공용, 약속 관리 티켓 02).
// 규칙: STATE-04-02, 09-03, 09-04, MEMBER-07-03, TIME-04-01~03, TIME-14-01~04(2026-11-11 결정).
// DB·시계 없이 입력만으로 검증한다.

const kst = (local: string) => new Date(`${local}+09:00`);
const slot = (local: string) => kst(local).getTime();

// 2026-11-12 15:00 KST 기준, 지금 범위 11-14~11-20
const NOW = kst("2026-11-12T15:00:00");
const CURRENT = {
  dateRangeStart: "2026-11-14",
  dateRangeEnd: "2026-11-20",
  dailyStartMinute: 540,
  dailyEndMinute: 1440,
};

function input(
  overrides: Partial<ChangeImpactInput["next"]> = {},
  more: Partial<ChangeImpactInput> = {},
) {
  return {
    current: CURRENT,
    next: {
      title: "팀 저녁 모임",
      participantLimit: 4,
      dateRange: { startDate: "2026-11-14", endDate: "2026-11-20" },
      votingDeadlineAt: "2026-11-13T18:00:00+09:00",
      ...overrides,
    },
    participants: [
      { participantId: "host", slots: [slot("2026-11-14T18:00:00"), slot("2026-11-20T19:00:00")] },
      { participantId: "minsu", slots: [slot("2026-11-15T10:00:00")] },
    ],
    now: NOW,
    ...more,
  } satisfies ChangeImpactInput;
}

describe("설정 변경 영향", () => {
  it("이름·정원·마감만 바뀌면 슬롯·버전·제출 상태를 건드리지 않는다", () => {
    const result = planSettingsChange(
      input({
        title: "새 이름",
        participantLimit: 6,
        votingDeadlineAt: "2026-11-14T00:00:00+09:00",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      rangeGrew: false,
      removedSlots: [],
      versionBumped: [],
    });
  });

  it("범위를 줄이면 범위 밖 슬롯을 지우고, 슬롯이 지워진 참여자만 버전을 올린다. 제출 상태는 그대로다", () => {
    const result = planSettingsChange(
      input({ dateRange: { startDate: "2026-11-14", endDate: "2026-11-18" } }),
    );

    expect(result).toMatchObject({
      ok: true,
      rangeGrew: false,
      removedSlots: [{ participantId: "host", slots: [slot("2026-11-20T19:00:00")] }],
      versionBumped: ["host"],
    });
  });

  it("범위를 넓히면 고를 수 있는 날짜가 늘어 active 전원의 제출 상태를 풀고 버전을 올린다", () => {
    const result = planSettingsChange(
      input({ dateRange: { startDate: "2026-11-14", endDate: "2026-11-22" } }),
    );

    expect(result).toMatchObject({
      ok: true,
      rangeGrew: true,
      removedSlots: [],
      versionBumped: ["host", "minsu"],
    });
  });

  it("범위를 옮기면 밖으로 나간 슬롯을 지우고, 새 날짜가 생겼으니 전원의 제출 상태를 푼다", () => {
    const result = planSettingsChange(
      input({ dateRange: { startDate: "2026-11-16", endDate: "2026-11-22" } }),
    );

    expect(result).toMatchObject({
      ok: true,
      rangeGrew: true,
      removedSlots: [
        { participantId: "host", slots: [slot("2026-11-14T18:00:00")] },
        { participantId: "minsu", slots: [slot("2026-11-15T10:00:00")] },
      ],
      versionBumped: ["host", "minsu"],
    });
  });

  describe("날짜 범위", () => {
    // 이미 시작한 약속: 지금 범위 11-10~11-20, 오늘은 11-12
    const started = { current: { ...CURRENT, dateRangeStart: "2026-11-10" } };

    it("이미 지난 기존 시작일은 그대로 둘 수 있다", () => {
      const result = planSettingsChange(
        input({ dateRange: { startDate: "2026-11-10", endDate: "2026-11-25" } }, started),
      );
      expect(result).toMatchObject({ ok: true, rangeGrew: true });
    });

    it("새로 고르는 시작일은 오늘 이후여야 한다", () => {
      const result = planSettingsChange(
        input({ dateRange: { startDate: "2026-11-11", endDate: "2026-11-20" } }, started),
      );
      expect(result).toMatchObject({ ok: false, errors: [{ field: "dateRange" }] });
    });

    it.each([
      ["89일 뒤(90일째)", "2027-02-07", true],
      ["90일 뒤(91일째)", "2027-02-08", false],
    ])("지난 시작일 기준으로도 양 끝 포함 90일까지: %s → 통과 %s", (_name, endDate, ok) => {
      const result = planSettingsChange(
        input({ dateRange: { startDate: "2026-11-10", endDate } }, started),
      );
      expect(result.ok).toBe(ok);
    });

    it("시작일을 앞당기면(오늘 이후) 범위가 넓어진 것이다", () => {
      const result = planSettingsChange(
        input({ dateRange: { startDate: "2026-11-13", endDate: "2026-11-20" } }),
      );
      expect(result).toMatchObject({ ok: true, rangeGrew: true, versionBumped: ["host", "minsu"] });
    });
  });

  describe("마감", () => {
    // 지금 11-12 15:00, 범위 마지막 날 11-20
    it.each([
      ["지금 + 30분(앞당기기)", "2026-11-12T15:30:00+09:00", true],
      ["지금 + 30분 미만", "2026-11-12T15:00:00+09:00", false],
      ["마지막 날 00:00 직전(늦추기)", "2026-11-19T23:30:00+09:00", true],
      ["마지막 날 00:00", "2026-11-20T00:00:00+09:00", false],
    ])("%s → 통과 %s", (_name, votingDeadlineAt, ok) => {
      const result = planSettingsChange(input({ votingDeadlineAt }));
      expect(result.ok ? [] : result.errors.map((e) => e.field)).toEqual(
        ok ? [] : ["votingDeadlineAt"],
      );
    });

    it("바꾸지 않은 기존 마감(재설정)은 30분 안으로 다가왔어도 다른 설정 변경을 막지 않는다", () => {
      const result = planSettingsChange(
        input(
          { title: "새 이름", votingDeadlineAt: "2026-11-12T15:00:00+09:00" },
          { keptVotingDeadline: kst("2026-11-12T15:00:00") },
        ),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("정원", () => {
    it("현재 active 인원까지는 줄일 수 있다", () => {
      expect(planSettingsChange(input({ participantLimit: 2 }))).toMatchObject({ ok: true });
    });

    it("현재 active 인원보다 작으면 CAPACITY_BELOW_ACTIVE_COUNT로 거부한다", () => {
      const three = [
        { participantId: "host", slots: [] },
        { participantId: "minsu", slots: [] },
        { participantId: "hyunwoo", slots: [] },
      ];

      expect(planSettingsChange(input({ participantLimit: 2 }, { participants: three }))).toEqual({
        ok: false,
        errors: [
          {
            field: "participantLimit",
            code: "CAPACITY_BELOW_ACTIVE_COUNT",
            message: "지금 3명이 참여 중이라 정원을 3명보다 줄일 수 없어요.",
          },
        ],
      });
    });

    it("2~30명 범위 밖이면 그 오류만 알린다(인원 부족 오류를 겹쳐 내지 않는다)", () => {
      const result = planSettingsChange(input({ participantLimit: 1 }));
      expect(result.ok ? [] : result.errors.map((e) => e.code ?? e.field)).toEqual([
        "participantLimit",
      ]);
    });
  });

  it("고른 시간이 없는 참여자도 범위가 넓어지면 버전을 올리고, 지울 슬롯 목록에는 넣지 않는다", () => {
    const withEmpty = [
      { participantId: "host", slots: [slot("2026-11-20T19:00:00")] },
      { participantId: "jisu", slots: [] },
    ];
    expect(
      planSettingsChange(
        input(
          { dateRange: { startDate: "2026-11-16", endDate: "2026-11-22" } },
          { participants: withEmpty },
        ),
      ),
    ).toMatchObject({ ok: true, removedSlots: [], versionBumped: ["host", "jisu"] });
    expect(
      planSettingsChange(
        input(
          { dateRange: { startDate: "2026-11-14", endDate: "2026-11-19" } },
          { participants: withEmpty },
        ),
      ),
    ).toMatchObject({
      ok: true,
      removedSlots: [{ participantId: "host", slots: [slot("2026-11-20T19:00:00")] }],
      versionBumped: ["host"],
    });
  });
});
