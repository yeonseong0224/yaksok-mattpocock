import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { cookieMaxAge, createTestClient } from "@/test/http";
import { passDeadline } from "@/test/db";
import {
  cancelPromise,
  closePromise,
  confirmPromise,
  createCollectingPromise,
  createDraftPromise,
  getAvailability,
  getMe,
  logIn,
  lookUpLink,
  registerParticipant,
  reopenPromise,
  slotAt,
  submitAvailability,
} from "@/test/flows";

// STATE-API-07 약속 취소(약속 관리 티켓 05). 방장만, 모집 중·마감·확정에서. 되돌릴 수 없다.

const twoHoursFrom14 = ["14:00", "14:30", "15:00", "15:30"].map((t) => slotAt(0, t));

async function setUp() {
  const host = createTestClient();
  const { promiseId, inviteToken } = await createCollectingPromise(host);
  const member = createTestClient();
  await registerParticipant(member, promiseId);
  return { host, member, promiseId, inviteToken };
}

describe("약속 취소", () => {
  it("방장이 취소하면 cancelled가 되고 취소 시각을 돌려주며 방장의 쿠키를 지운다", async () => {
    const { host, promiseId } = await setUp();

    const res = await cancelPromise(host, promiseId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      promiseId,
      promiseStatus: "cancelled",
      message: "취소된 약속입니다.",
    });
    const { cancelledAt } = res.body as { cancelledAt: string };
    expect(cancelledAt).toMatch(/\+09:00$/);
    expect(Math.abs(Date.parse(cancelledAt) - Date.now())).toBeLessThan(60_000);
    expect(cookieMaxAge(res)).toBe(0);
  });

  it("모든 세션이 즉시 만료되고, 참여자·입력 데이터는 그대로 남는다", async () => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: [slotAt(0, "14:00")] });

    await cancelPromise(host, promiseId);

    const sessions = await prisma.participantSession.findMany({
      where: { participant: { promiseId } },
    });
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.every((s) => s.expiresAt.getTime() <= Date.now())).toBe(true);
    const people = await prisma.participant.findMany({
      where: { promiseId },
      include: { availableSlots: true },
      orderBy: { createdAt: "asc" },
    });
    expect(people.map((p) => [p.role, p.status, p.availableSlots.length])).toEqual([
      ["host", "active", 0],
      ["member", "active", 1],
    ]);
  });

  it("취소 뒤에는 모든 약속 API가 인증보다 먼저 409 PROMISE_CANCELLED이고, 링크는 cancelled만 알린다", async () => {
    const { host, member, promiseId, inviteToken } = await setUp();

    await cancelPromise(host, promiseId);

    for (const res of [
      await getAvailability(member, promiseId),
      await getMe(member, promiseId),
      await logIn(createTestClient(), promiseId),
      await cancelPromise(host, promiseId),
      await reopenPromise(host, promiseId, { votingDeadlineAt: slotAt(1, "10:00") }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "PROMISE_CANCELLED" });
    }
    expect((await lookUpLink(createTestClient(), inviteToken)).body).toMatchObject({
      promiseStatus: "cancelled",
    });
  });

  it.each([
    ["마감", "closed"],
    ["확정", "confirmed"],
  ])("%s된 약속도 취소할 수 있다", async (_name, state) => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await closePromise(host, promiseId);
    if (state === "confirmed") await confirmPromise(host, promiseId, twoHoursFrom14[0]);

    const res = await cancelPromise(host, promiseId);

    expect(res.status).toBe(200);
    const row = await prisma.promise.findUniqueOrThrow({ where: { id: promiseId } });
    expect(row.status).toBe("cancelled");
    // 확정 일정은 보존한다(STATE-API-07 처리 순서 3).
    expect(row.confirmedStartAt !== null).toBe(state === "confirmed");
  });

  it("마감 시각이 지난 모집 중 약속도 취소할 수 있다", async () => {
    const { host, promiseId } = await setUp();
    await passDeadline(promiseId);

    expect((await cancelPromise(host, promiseId)).status).toBe(200);
  });

  describe("거절", () => {
    it("멤버는 403이고 약속은 그대로다", async () => {
      const { member, promiseId } = await setUp();

      const res = await cancelPromise(member, promiseId);

      expect(res.status).toBe(403);
      const row = await prisma.promise.findUniqueOrThrow({ where: { id: promiseId } });
      expect(row.status).toBe("collecting");
    });

    it("설정 중(draft) 약속은 409 INVALID_PROMISE_STATE", async () => {
      const host = createTestClient();
      const { promiseId } = await createDraftPromise(host);

      const res = await cancelPromise(host, promiseId);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: "INVALID_PROMISE_STATE",
        details: { promiseStatus: "draft" },
      });
    });

    it("로그인하지 않았으면 401", async () => {
      const { promiseId } = await setUp();

      expect((await cancelPromise(createTestClient(), promiseId)).status).toBe(401);
    });
  });
});
