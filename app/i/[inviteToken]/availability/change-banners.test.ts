import { describe, expect, it } from "vitest";
import { bannersFor, type SeenState } from "./change-banners";

// 변경 알림 배너 고르기(약속 관리 티켓 08). 이전에 본 상태와 지금 상태만으로 정한다.

const SEEN: SeenState = {
  status: "collecting",
  role: "member",
  title: "팀 저녁 모임",
  dateRangeStart: "2026-11-14",
  dateRangeEnd: "2026-11-20",
  participantLimit: 4,
  votingDeadlineAt: "2026-11-13T18:00:00.000+09:00",
  slotCount: 6,
  submitted: true,
};
// 지금은 지난번에 본 마감(11-13 18:00)보다 앞이다.
const NOW = Date.parse("2026-11-12T15:00:00+09:00");
const now = (patch: Partial<SeenState>): SeenState => ({ ...SEEN, ...patch });
const texts = (prev: SeenState | null, curr: SeenState, at = NOW) =>
  bannersFor(prev, curr, at).map((b) => b.text);

describe("변경 알림 배너", () => {
  it("처음 방문(저장된 상태 없음)이나 바뀐 것이 없으면 띄우지 않는다", () => {
    expect(texts(null, SEEN)).toEqual([]);
    expect(texts(SEEN, SEEN)).toEqual([]);
  });

  it("모집 중에 방장이 이름·범위·정원·마감을 바꾸면 알린다", () => {
    for (const patch of [
      { title: "새 이름" },
      { dateRangeEnd: "2026-11-22" },
      { participantLimit: 6 },
      { votingDeadlineAt: "2026-11-14T12:00:00.000+09:00" },
    ]) {
      expect(texts(SEEN, now(patch))).toEqual(["방장이 설정을 바꿨어요."]);
    }
  });

  it("범위가 줄어 내 입력이 지워졌으면 함께 알린다", () => {
    expect(texts(SEEN, now({ dateRangeEnd: "2026-11-18", slotCount: 4 }))).toEqual([
      "방장이 설정을 바꿨어요. 범위 밖으로 나간 내 입력 2개가 지워졌어요.",
    ]);
  });

  it("범위가 늘어 내 제출 상태가 풀렸으면 다시 제출해 달라고 알린다", () => {
    expect(texts(SEEN, now({ dateRangeEnd: "2026-11-22", submitted: false }))).toEqual([
      "방장이 설정을 바꿨어요.",
      "고를 수 있는 시간이 늘었어요. 다시 확인하고 제출해 주세요.",
    ]);
  });

  it("마감·확정된 약속이 다시 모집 중이 되면 재조율을 알린다(설정 변경 배너는 겹쳐 띄우지 않는다)", () => {
    for (const status of ["closed", "confirmed"] as const) {
      expect(
        texts(now({ status }), now({ votingDeadlineAt: "2026-11-15T21:00:00.000+09:00" })),
      ).toEqual(["다시 조율 중이에요. 내 가능 시간을 확인해 주세요."]);
    }
    expect(
      texts(
        now({ status: "closed" }),
        now({ votingDeadlineAt: "2026-11-15T21:00:00.000+09:00", submitted: false }),
      ),
    ).toEqual([
      "다시 조율 중이에요. 내 가능 시간을 확인해 주세요.",
      "고를 수 있는 시간이 늘었어요. 다시 확인하고 제출해 주세요.",
    ]);
  });

  it("시간표를 보지 않은 동안 마감·확정됐다가 다시 열려도(지난번 본 마감이 이미 지남) 재조율로 알린다", () => {
    const later = Date.parse("2026-11-14T09:00:00+09:00");
    expect(texts(SEEN, now({ votingDeadlineAt: "2026-11-15T21:00:00.000+09:00" }), later)).toEqual([
      "다시 조율 중이에요. 내 가능 시간을 확인해 주세요.",
    ]);
  });

  it("재조율로 범위가 줄어 내 입력이 지워졌으면 함께 알린다", () => {
    expect(
      texts(
        now({ status: "closed" }),
        now({ votingDeadlineAt: "2026-11-15T21:00:00.000+09:00", slotCount: 2 }),
      ),
    ).toEqual([
      "다시 조율 중이에요. 내 가능 시간을 확인해 주세요. 범위 밖으로 나간 내 입력 4개가 지워졌어요.",
    ]);
  });

  it("마감(조기 마감 포함)·확정으로 바뀐 것은 설정 변경이 아니다", () => {
    expect(
      texts(SEEN, now({ status: "closed", votingDeadlineAt: "2026-11-12T15:00:00.000+09:00" })),
    ).toEqual([]);
    expect(texts(now({ status: "closed" }), now({ status: "confirmed" }))).toEqual([]);
  });

  it("방장 권한을 넘겨받으면 알린다", () => {
    expect(texts(SEEN, now({ role: "host" }))).toEqual(["방장 권한을 넘겨받았어요."]);
  });

  it("방장 본인의 변경에는 띄우지 않는다(저장 직후 이미 안내를 봤다)", () => {
    const host = now({ role: "host" });
    expect(texts(host, { ...host, title: "새 이름", submitted: false })).toEqual([]);
    expect(texts({ ...host, status: "closed" }, host)).toEqual([]);
  });

  it("내가 직접 입력을 고쳐 제출한 것은 알리지 않는다", () => {
    expect(texts(SEEN, now({ slotCount: 9 }))).toEqual([]);
    expect(texts(now({ submitted: false }), SEEN)).toEqual([]);
  });

  it("배너마다 닫기용 id가 다르다", () => {
    const ids = bannersFor(
      now({ status: "closed" }),
      now({ role: "host", submitted: false, votingDeadlineAt: "2026-11-15T21:00:00.000+09:00" }),
      NOW,
    ).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
