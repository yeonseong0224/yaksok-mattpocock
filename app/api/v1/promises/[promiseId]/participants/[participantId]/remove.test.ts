import { describe, expect, it } from "vitest";
import { createTestClient } from "@/test/http";
import { passDeadline, storedPromiseStatus } from "@/test/db";
import {
  cancelPromise,
  closePromise,
  createCollectingPromise,
  getAvailability,
  getCandidates,
  getMe,
  getRoster,
  leavePromise,
  logIn,
  registerParticipant,
  removeParticipant,
  slotAt,
  submitAvailability,
} from "@/test/flows";

// MEMBER-API-08 방장의 내보내기(약속 관리 티켓 07). 모집 중(마감 전)에만, 방장만.

const twoHoursFrom14 = ["14:00", "14:30", "15:00", "15:30"].map((t) => slotAt(0, t));
const HYESEUNG = { nickname: "혜승", pin: "1357" };
const MINSU = { nickname: "민수", pin: "2468" };
type Client = ReturnType<typeof createTestClient>;

async function idOf(client: Client, promiseId: string) {
  return ((await getMe(client, promiseId)).body as { participantId: string }).participantId;
}

async function setUp() {
  const host = createTestClient();
  const { promiseId } = await createCollectingPromise(host);
  const member = createTestClient();
  await registerParticipant(member, promiseId, HYESEUNG);
  const memberId = await idOf(member, promiseId);
  return { host, member, memberId, promiseId };
}

describe("내보내기", () => {
  it("내보내면 그 사람은 로그인이 풀리고, 명단·히트맵·후보에서 바로 빠진다", async () => {
    const { host, member, memberId, promiseId } = await setUp();
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });

    const res = await removeParticipant(host, promiseId, memberId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      participantId: memberId,
      participantStatus: "cancelled",
      currentParticipantCount: 1,
      participantLimit: 4,
    });
    expect((await getMe(member, promiseId)).status).toBe(401);
    const roster = (await getRoster(host, promiseId)).body as { participants: unknown[] };
    expect(roster.participants).toHaveLength(1);
    const board = (await getAvailability(host, promiseId)).body as { totalParticipants: number };
    expect(board.totalParticipants).toBe(1);
    expect((await getCandidates(host, promiseId)).body).toMatchObject({ blocks: [] });
  });

  it("내보내진 사람은 다시 로그인하면 401이고, 같은 닉네임으로 다시 참여할 수 없다", async () => {
    const { host, memberId, promiseId } = await setUp();
    await removeParticipant(host, promiseId, memberId);

    const login = await logIn(createTestClient(), promiseId, HYESEUNG);
    expect(login.status).toBe(401);
    expect(login.body).toMatchObject({ code: "UNAUTHENTICATED" });
    const again = await registerParticipant(createTestClient(), promiseId, HYESEUNG);
    expect(again.body).toMatchObject({ code: "NICKNAME_TAKEN" });
  });

  it("이미 나간 사람을 내보내면 바꾸지 않고 200(멱등)", async () => {
    const { host, member, memberId, promiseId } = await setUp();
    await leavePromise(member, promiseId);

    const res = await removeParticipant(host, promiseId, memberId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ participantStatus: "cancelled", currentParticipantCount: 1 });
  });

  describe("거절", () => {
    it("방장이 자기 자신을 지정하면 409 CANNOT_REMOVE_SELF", async () => {
      const { host, promiseId } = await setUp();

      const res = await removeParticipant(host, promiseId, await idOf(host, promiseId));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "CANNOT_REMOVE_SELF" });
    });

    it("없는 참여자나 다른 약속의 참여자는 404 PARTICIPANT_NOT_FOUND", async () => {
      const { host, promiseId } = await setUp();
      const other = createTestClient();
      const { promiseId: otherPromiseId } = await createCollectingPromise(other);

      for (const target of [crypto.randomUUID(), await idOf(other, otherPromiseId)]) {
        const res = await removeParticipant(host, promiseId, target);
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: "PARTICIPANT_NOT_FOUND" });
      }
    });

    it("멤버는 403", async () => {
      const { member, promiseId } = await setUp();
      const minsu = createTestClient();
      await registerParticipant(minsu, promiseId, MINSU);

      const res = await removeParticipant(member, promiseId, await idOf(minsu, promiseId));

      expect(res.status).toBe(403);
    });

    it("마감된 약속은 409 INVALID_PROMISE_STATE", async () => {
      const { host, memberId, promiseId } = await setUp();
      await closePromise(host, promiseId);

      const res = await removeParticipant(host, promiseId, memberId);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "INVALID_PROMISE_STATE" });
    });

    it("마감 시각이 지났으면 DB를 closed로 바꾸고 409 DEADLINE_PASSED", async () => {
      const { host, memberId, promiseId } = await setUp();
      await passDeadline(promiseId);

      const res = await removeParticipant(host, promiseId, memberId);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "DEADLINE_PASSED" });
      expect(await storedPromiseStatus(promiseId)).toBe("closed");
    });

    it("취소된 약속은 409 PROMISE_CANCELLED", async () => {
      const { host, memberId, promiseId } = await setUp();
      await cancelPromise(host, promiseId);

      const res = await removeParticipant(host, promiseId, memberId);

      expect(res.body).toMatchObject({ code: "PROMISE_CANCELLED" });
    });

    it("참여자 ID 형식이 틀리면 400", async () => {
      const { host, promiseId } = await setUp();

      expect((await removeParticipant(host, promiseId, "not-a-uuid")).status).toBe(400);
    });
  });
});
