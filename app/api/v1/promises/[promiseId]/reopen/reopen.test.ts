import { describe, expect, it } from "vitest";
import { createTestClient, cookieMaxAge } from "@/test/http";
import { passDeadline, storedPromiseStatus } from "@/test/db";
import {
  closePromise,
  confirmPromise,
  createCollectingPromise,
  getAvailability,
  getMe,
  getPromise,
  registerParticipant,
  reopenPromise,
  slotAt,
  submitAvailability,
} from "@/test/flows";
import { addDays, kstDate } from "@/lib/time";

// STATE-API-06 재조율 시작(약속 관리 티켓 04). 마감·확정된 약속을 새 마감과 함께 다시 모집 중으로 돌린다.
// 슬롯·버전·제출 상태 반영은 재설정과 같은 단계(applySettingsChange)라 여기서는 재조율만의 차이를 본다.

const DAY_SECONDS = 24 * 60 * 60;
// 모집 시작 본문(validStartBody)과 같은 범위: 모레부터 8일
const startDate = addDays(kstDate(new Date()), 2);
const endDate = addDays(startDate, 7);
const newDeadline = `${addDays(startDate, 3)}T21:00:00+09:00`;
const twoHoursFrom14 = ["14:00", "14:30", "15:00", "15:30"].map((t) => slotAt(0, t));

type Client = ReturnType<typeof createTestClient>;
const availabilityOf = async (client: Client, promiseId: string) =>
  (await getAvailability(client, promiseId)).body as {
    status: string;
    me: { version: number; submitted: boolean; slots: string[] };
  };

/** 방장·멤버가 같은 2시간을 제출하고 방장이 마감한 약속 */
async function closedPromise() {
  const host = createTestClient();
  const { promiseId } = await createCollectingPromise(host);
  const member = createTestClient();
  await registerParticipant(member, promiseId);
  await submitAvailability(host, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
  await submitAvailability(member, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
  expect((await closePromise(host, promiseId)).status).toBe(200);
  return { host, member, promiseId };
}

describe("재조율", () => {
  it("마감된 약속을 새 마감과 함께 다시 모집 중으로 돌리고, 범위를 그대로 두면 입력과 제출 상태도 그대로다", async () => {
    const { host, member, promiseId } = await closedPromise();

    const res = await reopenPromise(host, promiseId, { votingDeadlineAt: newDeadline });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      promiseId,
      promiseStatus: "collecting",
      currentConfirmation: null,
      settings: { dateRange: { startDate, endDate }, title: "팀 저녁 모임" },
      changeImpact: {
        rangeChanged: false,
        submissionsReset: false,
        removedSlotCount: 0,
        versionChangedParticipantCount: 0,
        confirmationCleared: false,
        hasCandidates: true,
      },
    });
    const mine = await availabilityOf(member, promiseId);
    expect(mine).toMatchObject({ status: "collecting", me: { version: 1, submitted: true } });
    // 다시 모집 중이라 입력을 고칠 수 있다.
    const resubmit = await submitAvailability(member, promiseId, {
      baseVersion: 1,
      slots: [slotAt(1, "10:00")],
    });
    expect(resubmit.status).toBe(200);
  });

  it("확정된 약속을 다시 열면 확정 일정이 해제된다", async () => {
    const { host, member, promiseId } = await closedPromise();
    expect((await confirmPromise(host, promiseId, twoHoursFrom14[0])).status).toBe(200);

    const res = await reopenPromise(host, promiseId, { votingDeadlineAt: newDeadline });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      promiseStatus: "collecting",
      currentConfirmation: null,
      changeImpact: { confirmationCleared: true },
    });
    expect((await getPromise(member, promiseId)).body).toMatchObject({
      promiseStatus: "collecting",
      currentConfirmation: null,
    });
  });

  it("이름·날짜 범위·정원·소요 시간도 함께 바꿀 수 있고, 범위가 늘면 제출 상태가 풀려도 남은 선택은 그대로다", async () => {
    const { host, member, promiseId } = await closedPromise();

    const res = await reopenPromise(host, promiseId, {
      votingDeadlineAt: newDeadline,
      dateRange: { startDate, endDate: addDays(endDate, 3) },
      participantLimit: 6,
      title: "다시 모여요",
      durationMinutes: 90,
    });

    expect(res.body).toMatchObject({
      settings: {
        title: "다시 모여요",
        participantLimit: 6,
        durationMinutes: 90,
        dateRange: { endDate: addDays(endDate, 3) },
      },
      changeImpact: {
        rangeChanged: true,
        submissionsReset: true,
        submissionsResetParticipantCount: 2,
        versionChangedParticipantCount: 2,
      },
    });
    const mine = await availabilityOf(member, promiseId);
    expect(mine.me).toMatchObject({ version: 2, submitted: false });
    expect(mine.me.slots).toHaveLength(4);
  });

  it("다시 열리면 빈자리가 있을 때 새 사람이 참여할 수 있다", async () => {
    const { host, promiseId } = await closedPromise();
    const newcomer = createTestClient();
    const body = { nickname: "민수", pin: "2468" };
    expect((await registerParticipant(newcomer, promiseId, body)).status).toBe(409);

    await reopenPromise(host, promiseId, { votingDeadlineAt: newDeadline });

    expect((await registerParticipant(newcomer, promiseId, body)).status).toBe(201);
  });

  it("세션이 새 마감 + 7일까지로 맞춰진다", async () => {
    const { host, member, promiseId } = await closedPromise();
    const expected = Date.parse(newDeadline) + 7 * DAY_SECONDS * 1000;

    const res = await reopenPromise(host, promiseId, { votingDeadlineAt: newDeadline });

    expect(Math.abs(Date.now() + cookieMaxAge(res) * 1000 - expected)).toBeLessThan(60_000);
    const after = (await getMe(member, promiseId)).body as { sessionExpiresAt: string };
    expect(Date.parse(after.sessionExpiresAt)).toBe(expected);
  });

  it("마감 시각이 지났지만 아직 DB가 collecting인 약속도 마감된 것으로 보고 다시 연다", async () => {
    const host = createTestClient();
    const { promiseId } = await createCollectingPromise(host);
    await passDeadline(promiseId);

    const res = await reopenPromise(host, promiseId, { votingDeadlineAt: newDeadline });

    expect(res.status).toBe(200);
    expect(await storedPromiseStatus(promiseId)).toBe("collecting");
  });

  describe("거절", () => {
    it("모집 중인 약속은 409 INVALID_PROMISE_STATE", async () => {
      const host = createTestClient();
      const { promiseId } = await createCollectingPromise(host);

      const res = await reopenPromise(host, promiseId, { votingDeadlineAt: newDeadline });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: "INVALID_PROMISE_STATE",
        details: { promiseStatus: "collecting", allowedStates: ["closed", "confirmed"] },
      });
    });

    it("멤버는 403", async () => {
      const { member, promiseId } = await closedPromise();

      const res = await reopenPromise(member, promiseId, { votingDeadlineAt: newDeadline });

      expect(res.status).toBe(403);
    });

    it.each([
      ["마감 없음", { participantLimit: 5 }],
      ["마감 형식이 틀림", { votingDeadlineAt: 123 }],
      ["시작·종료 중 하나만", { votingDeadlineAt: newDeadline, dateRange: { startDate } }],
    ])("%s → 400 INVALID_REQUEST", async (_name, body) => {
      const { host, promiseId } = await closedPromise();

      const res = await reopenPromise(host, promiseId, body);

      expect(res.status).toBe(400);
    });

    it("지난 마감을 그대로 보내면 422이고 아무것도 바뀌지 않는다", async () => {
      const { host, promiseId } = await closedPromise();
      const old = (await getPromise(host, promiseId)).body as {
        settings: { votingDeadlineAt: string };
      };

      const res = await reopenPromise(host, promiseId, {
        votingDeadlineAt: old.settings.votingDeadlineAt.replace(/\.\d{3}/, ""),
      });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { field: "votingDeadlineAt" },
      });
      expect(await storedPromiseStatus(promiseId)).toBe("closed");
    });

    it("정원을 현재 참여 인원보다 줄이면 422 CAPACITY_BELOW_ACTIVE_COUNT", async () => {
      const host = createTestClient();
      const { promiseId } = await createCollectingPromise(host);
      await registerParticipant(createTestClient(), promiseId);
      await registerParticipant(createTestClient(), promiseId, { nickname: "민수", pin: "2468" });
      await closePromise(host, promiseId);

      const res = await reopenPromise(host, promiseId, {
        votingDeadlineAt: newDeadline,
        participantLimit: 2,
      });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "CAPACITY_BELOW_ACTIVE_COUNT" });
    });
  });
});
