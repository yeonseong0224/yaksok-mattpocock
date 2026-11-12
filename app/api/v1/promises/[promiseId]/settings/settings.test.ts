import { describe, expect, it } from "vitest";
import { createTestClient, cookieMaxAge } from "@/test/http";
import { passDeadline, storedPromiseStatus } from "@/test/db";
import {
  closePromise,
  createCollectingPromise,
  getAvailability,
  getCandidates,
  getMe,
  getPromise,
  registerParticipant,
  slotAt,
  submitAvailability,
  updateSettings,
} from "@/test/flows";
import { addDays, kstDate } from "@/lib/time";

// STATE-API-03 모집 중 설정 변경(재설정, 약속 관리 티켓 03).
// 무엇이 지워지고 누구 버전이 오르는지는 영향 계산 모듈(change-impact)의 단위 테스트가 본다.
// 여기서는 그 결과가 DB·응답·세션에 한 번에 반영되는지를 본다.

const DAY_SECONDS = 24 * 60 * 60;
// 모집 시작 본문(validStartBody)과 같은 범위: 모레부터 8일
const startDate = addDays(kstDate(new Date()), 2);
const endDate = addDays(startDate, 7);
const twoHoursFrom14 = (day: number) =>
  ["14:00", "14:30", "15:00", "15:30"].map((t) => slotAt(day, t));

type Availability = {
  participants: { nickname: string; availableSlots: string[] }[];
  me: { version: number; submitted: boolean; slots: string[] };
};
const availabilityOf = async (client: ReturnType<typeof createTestClient>, promiseId: string) =>
  (await getAvailability(client, promiseId)).body as Availability;

async function setUp() {
  const host = createTestClient();
  const { promiseId } = await createCollectingPromise(host);
  const member = createTestClient();
  await registerParticipant(member, promiseId);
  return { host, member, promiseId };
}

describe("재설정", () => {
  it("이름·정원·마감만 바꾸면 설정만 바뀌고 제출 상태와 버전은 그대로다", async () => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: [slotAt(0, "14:00")] });
    const votingDeadlineAt = `${addDays(startDate, 3)}T21:00:00+09:00`;

    const res = await updateSettings(host, promiseId, {
      title: "새 이름",
      participantLimit: 6,
      votingDeadlineAt,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      promiseId,
      promiseStatus: "collecting",
      settings: {
        title: "새 이름",
        participantLimit: 6,
        dateRange: { startDate, endDate },
        dailyTimeRange: { startTime: "09:00", endTime: "24:00" },
        durationMinutes: 120,
        votingDeadlineAt: `${addDays(startDate, 3)}T21:00:00.000+09:00`,
      },
      changeImpact: {
        rangeChanged: false,
        hasAddedSelectableSlots: false,
        submissionsReset: false,
        removedSlotCount: 0,
        versionChangedParticipantCount: 0,
        submissionsResetParticipantCount: 0,
        hasCandidates: false,
      },
    });
    expect((await availabilityOf(member, promiseId)).me).toMatchObject({
      version: 1,
      submitted: true,
    });
  });

  it("범위를 줄이면 범위 밖 슬롯만 지우고, 지워진 사람만 버전이 오르며 제출 상태는 그대로다", async () => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: [slotAt(0, "14:00")] });
    await submitAvailability(member, promiseId, {
      baseVersion: 0,
      slots: [slotAt(0, "14:00"), slotAt(7, "10:00"), slotAt(7, "10:30")],
    });

    const res = await updateSettings(host, promiseId, {
      dateRange: { startDate, endDate: addDays(startDate, 5) },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      changeImpact: {
        rangeChanged: true,
        hasAddedSelectableSlots: false,
        submissionsReset: false,
        removedSlotCount: 2,
        removedSlotParticipantCount: 1,
        versionChangedParticipantCount: 1,
        submissionsResetParticipantCount: 0,
      },
    });
    const mine = (await availabilityOf(member, promiseId)).me;
    expect(mine).toMatchObject({ version: 2, submitted: true });
    expect(mine.slots.map(Date.parse)).toEqual([Date.parse(slotAt(0, "14:00"))]);
    expect((await availabilityOf(host, promiseId)).me).toMatchObject({
      version: 1,
      submitted: true,
    });
  });

  it("범위를 넓히면 전원의 제출 상태를 풀고 버전을 올리지만, 남은 선택은 후보 계산에 계속 들어간다(X-07)", async () => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: twoHoursFrom14(0) });
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: twoHoursFrom14(0) });

    const res = await updateSettings(host, promiseId, {
      dateRange: { startDate, endDate: addDays(endDate, 2) },
    });

    expect(res.body).toMatchObject({
      changeImpact: {
        rangeChanged: true,
        hasAddedSelectableSlots: true,
        submissionsReset: true,
        removedSlotCount: 0,
        versionChangedParticipantCount: 2,
        submissionsResetParticipantCount: 2,
        hasCandidates: true,
      },
    });
    const board = await availabilityOf(member, promiseId);
    expect(board.me).toMatchObject({ version: 2, submitted: false });
    // 제출 상태가 풀려도 남은 선택은 다른 사람에게도 보이고 후보에도 들어간다.
    expect(board.participants.every((p) => p.availableSlots.length === 4)).toBe(true);
    const candidates = (await getCandidates(member, promiseId)).body as {
      candidates: { availableParticipantCount: number }[];
    };
    expect(candidates.candidates).toEqual([
      expect.objectContaining({ availableParticipantCount: 2 }),
    ]);
  });

  it("마감을 바꾸면 active 참여자의 유효한 세션이 새 마감 + 7일까지로 맞춰진다", async () => {
    const { host, member, promiseId } = await setUp();
    const votingDeadlineAt = `${addDays(startDate, 4)}T12:00:00+09:00`;
    const expected = Date.parse(votingDeadlineAt) + 7 * DAY_SECONDS * 1000;

    const res = await updateSettings(host, promiseId, { votingDeadlineAt });

    const maxAge = cookieMaxAge(res);
    expect(Math.abs(Date.now() + maxAge * 1000 - expected)).toBeLessThan(60_000);
    const after = (await getMe(member, promiseId)).body as { sessionExpiresAt: string };
    expect(Date.parse(after.sessionExpiresAt)).toBe(expected);
  });

  describe("거절", () => {
    it("정원을 현재 참여 인원보다 줄이면 422 CAPACITY_BELOW_ACTIVE_COUNT", async () => {
      const { host, promiseId } = await setUp();
      await registerParticipant(createTestClient(), promiseId, { nickname: "민수", pin: "2468" });

      const res = await updateSettings(host, promiseId, { participantLimit: 2 });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: "CAPACITY_BELOW_ACTIVE_COUNT",
        details: { field: "participantLimit" },
      });
    });

    it("규칙에 어긋난 값이면 422 VALIDATION_FAILED이고 아무것도 바뀌지 않는다", async () => {
      const { host, promiseId } = await setUp();

      const res = await updateSettings(host, promiseId, { title: "새 이름", participantLimit: 31 });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { field: "participantLimit" },
      });
      expect((await getPromise(host, promiseId)).body).toMatchObject({
        settings: { title: "팀 저녁 모임", participantLimit: 4 },
      });
    });

    it.each([
      ["빈 본문", {}],
      ["바꿀 수 없는 필드만", { dailyTimeRange: { startTime: "10:00", endTime: "20:00" } }],
      ["시작·종료 중 하나만", { dateRange: { startDate } }],
      ["타입이 틀린 값", { participantLimit: "5" }],
    ])("%s → 400 INVALID_REQUEST", async (_name, body) => {
      const { host, promiseId } = await setUp();

      const res = await updateSettings(host, promiseId, body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "INVALID_REQUEST" });
    });

    it("하루 시간 범위·약속 길이는 모집 시작처럼 무시한다", async () => {
      const { host, promiseId } = await setUp();

      const res = await updateSettings(host, promiseId, {
        title: "새 이름",
        dailyTimeRange: { startTime: "10:00", endTime: "20:00" },
        durationMinutes: 60,
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        settings: {
          title: "새 이름",
          dailyTimeRange: { startTime: "09:00", endTime: "24:00" },
          durationMinutes: 120,
        },
      });
    });

    it("멤버는 403", async () => {
      const { member, promiseId } = await setUp();

      const res = await updateSettings(member, promiseId, { title: "몰래" });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "FORBIDDEN" });
    });

    it("마감 시각이 지났으면 DB를 closed로 바꾸고 409", async () => {
      const { host, promiseId } = await setUp();
      await passDeadline(promiseId);

      const res = await updateSettings(host, promiseId, { title: "새 이름" });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: "INVALID_PROMISE_STATE",
        details: { promiseStatus: "closed" },
      });
      expect(await storedPromiseStatus(promiseId)).toBe("closed");
    });

    it("마감된 약속은 409", async () => {
      const { host, promiseId } = await setUp();
      await closePromise(host, promiseId);

      const res = await updateSettings(host, promiseId, { title: "새 이름" });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "INVALID_PROMISE_STATE" });
    });
  });
});
