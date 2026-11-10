import { describe, expect, it } from "vitest";
import { cookieMaxAge, createTestClient, type TestClient } from "@/test/http";
import { passDeadline } from "@/test/db";
import {
  closePromise,
  createCollectingPromise,
  createDraftPromise,
  getMe,
  getPromise,
  logIn,
  registerParticipant,
  slotAt,
  submitAvailability,
} from "@/test/flows";

// STATE-API-04 방장 마감(조기 마감)

const DAY_SECONDS = 24 * 60 * 60;
const secondsUntil = (iso: string) => (Date.parse(iso) - Date.now()) / 1000;

async function deadlineOf(client: TestClient, promiseId: string): Promise<string> {
  const body = (await getPromise(client, promiseId)).body as {
    settings: { votingDeadlineAt: string };
  };
  return body.settings.votingDeadlineAt;
}

async function setUp() {
  const host = createTestClient();
  const { promiseId } = await createCollectingPromise(host);
  const member = createTestClient();
  await registerParticipant(member, promiseId);
  return { host, member, promiseId };
}

describe("조기 마감", () => {
  it("방장이 마감하면 약속이 마감되고 더 이상 제출할 수 없다", async () => {
    const { host, member, promiseId } = await setUp();

    const res = await closePromise(host, promiseId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ promiseId, promiseStatus: "closed" });
    expect((await getPromise(member, promiseId)).body).toMatchObject({ promiseStatus: "closed" });
    const submit = await submitAvailability(member, promiseId, {
      baseVersion: 0,
      slots: [slotAt(0, "14:00")],
    });
    expect(submit.status).toBe(409);
    expect(submit.body).toMatchObject({ code: "VOTING_CLOSED" });
  });

  it("마감한 시각이 약속의 마감 시각이 된다", async () => {
    const { host, promiseId } = await setUp();

    await closePromise(host, promiseId);

    const deadline = await deadlineOf(host, promiseId);
    expect(Math.abs(secondsUntil(deadline))).toBeLessThan(60);
  });

  it("조기 마감하면 모든 세션이 실제 마감 시각 + 7일까지로 맞춰진다", async () => {
    const { host, member, promiseId } = await setUp();
    // 원래 마감은 약 24시간 뒤라 세션은 약 8일 남아 있다.
    const before = (await getMe(member, promiseId)).body as { sessionExpiresAt: string };
    expect(secondsUntil(before.sessionExpiresAt)).toBeGreaterThan(7.5 * DAY_SECONDS);

    const res = await closePromise(host, promiseId);

    expect(cookieMaxAge(res)).toBeGreaterThan(7 * DAY_SECONDS - 60);
    expect(cookieMaxAge(res)).toBeLessThanOrEqual(7 * DAY_SECONDS);
    const after = (await getMe(member, promiseId)).body as { sessionExpiresAt: string };
    // DB 시계와 테스트 시계의 몇 ms 차이를 허용한다.
    expect(secondsUntil(after.sessionExpiresAt)).toBeLessThanOrEqual(7 * DAY_SECONDS + 1);
    expect(secondsUntil(after.sessionExpiresAt)).toBeGreaterThan(7 * DAY_SECONDS - 60);
  });

  it("조기 마감한 약속에 다시 로그인하면 새 세션도 실제 마감 시각 + 7일까지다", async () => {
    const { host, promiseId } = await setUp();
    await closePromise(host, promiseId);

    const res = await logIn(createTestClient(), promiseId);

    expect(cookieMaxAge(res)).toBeLessThanOrEqual(7 * DAY_SECONDS);
    expect(cookieMaxAge(res)).toBeGreaterThan(7 * DAY_SECONDS - 60);
  });

  it("이미 마감된 약속을 다시 마감하면 바꾸지 않고 200", async () => {
    const { host, promiseId } = await setUp();
    await closePromise(host, promiseId);
    const firstDeadline = await deadlineOf(host, promiseId);

    const res = await closePromise(host, promiseId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ promiseId, promiseStatus: "closed" });
    const again = await deadlineOf(host, promiseId);
    expect(again).toBe(firstDeadline);
  });

  it("마감 시각이 이미 지났으면 마감 시각을 바꾸지 않고 마감 상태만 반영한다", async () => {
    const { host, promiseId } = await setUp();
    await passDeadline(promiseId, "1 hour");
    const before = await deadlineOf(host, promiseId);

    const res = await closePromise(host, promiseId);

    expect(res.body).toEqual({ promiseId, promiseStatus: "closed" });
    const after = await deadlineOf(host, promiseId);
    expect(after).toBe(before);
  });

  it("참여자가 모두 제출해도 저절로 마감되지 않는다", async () => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: [slotAt(0, "14:00")] });
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: [slotAt(0, "14:00")] });

    const res = await getPromise(host, promiseId);

    expect(res.body).toMatchObject({ promiseStatus: "collecting" });
  });

  describe("권한과 상태", () => {
    it("멤버는 마감할 수 없다(403)", async () => {
      const { member, promiseId } = await setUp();

      const res = await closePromise(member, promiseId);

      expect(res.status).toBe(403);
      expect((await getPromise(member, promiseId)).body).toMatchObject({
        promiseStatus: "collecting",
      });
    });

    it("로그인하지 않은 사람은 마감할 수 없다(401)", async () => {
      const { promiseId } = await setUp();

      const res = await closePromise(createTestClient(), promiseId);

      expect(res.status).toBe(401);
    });

    it("설정 중(draft)인 약속은 마감할 수 없다(409 INVALID_PROMISE_STATE)", async () => {
      const host = createTestClient();
      const { promiseId } = await createDraftPromise(host);

      const res = await closePromise(host, promiseId);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "INVALID_PROMISE_STATE" });
    });
  });
});
