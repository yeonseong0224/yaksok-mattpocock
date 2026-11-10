import { describe, expect, it } from "vitest";
import { createTestClient, type TestClient } from "@/test/http";
import { cancelParticipant, moveSlotToPast, passDeadline, storedPromiseStatus } from "@/test/db";
import {
  createCollectingPromise,
  createDraftPromise,
  getAvailability,
  getPromise,
  registerParticipant,
  slotAt,
  submitAvailability,
} from "@/test/flows";

// TIME-API-01 가능 시간 제출

const ms = (iso: string) => Date.parse(iso);
const sameInstants = (actual: string[], expected: string[]) =>
  expect(actual.map(ms)).toEqual(expected.map(ms));

async function setUp() {
  const host = createTestClient();
  const { promiseId } = await createCollectingPromise(host);
  const member = createTestClient();
  await registerParticipant(member, promiseId);
  return { host, member, promiseId };
}

type Submitted = {
  version: number;
  submitted: boolean;
  submittedAt: string;
  slots: string[];
  droppedSlotCount: number;
};

async function submit(client: TestClient, promiseId: string, baseVersion: number, slots: string[]) {
  return submitAvailability(client, promiseId, { baseVersion, slots });
}

describe("가능 시간 제출", () => {
  it("제출하면 내 슬롯이 저장되고 버전이 1 오르며, 다른 참여자의 현황에 보인다", async () => {
    const { host, member, promiseId } = await setUp();
    const slots = [slotAt(0, "14:30"), slotAt(0, "14:00")];

    const res = await submit(member, promiseId, 0, slots);

    expect(res.status).toBe(200);
    const body = res.body as Submitted;
    expect(body).toMatchObject({ version: 1, submitted: true, droppedSlotCount: 0 });
    expect(body.submittedAt).toMatch(/\.\d{3}\+09:00$/);
    sameInstants(body.slots, [slotAt(0, "14:00"), slotAt(0, "14:30")]);
    const seenByHost = (await getAvailability(host, promiseId)).body as {
      participants: { nickname: string; availableSlots: string[] }[];
    };
    const hyeseung = seenByHost.participants.find((p) => p.nickname === "혜승")!;
    sameInstants(hyeseung.availableSlots, [slotAt(0, "14:00"), slotAt(0, "14:30")]);
  });

  it("다시 제출하면 미래 슬롯 전체가 바뀐다", async () => {
    const { member, promiseId } = await setUp();
    await submit(member, promiseId, 0, [slotAt(0, "14:00")]);

    const res = await submit(member, promiseId, 1, [slotAt(1, "10:00")]);

    expect(res.body).toMatchObject({ version: 2 });
    sameInstants((res.body as Submitted).slots, [slotAt(1, "10:00")]);
  });

  it("날짜·하루 시간 범위 밖의 슬롯은 빼고 저장하고 그 수를 알려준다", async () => {
    const { member, promiseId } = await setUp();

    const res = await submit(member, promiseId, 0, [
      slotAt(0, "08:30"), // 하루 시작(09:00)보다 앞
      slotAt(30, "14:00"), // 날짜 범위 밖
      slotAt(0, "23:30"), // 23:30~24:00은 마지막 슬롯으로 허용
    ]);

    expect(res.body).toMatchObject({ droppedSlotCount: 2 });
    sameInstants((res.body as Submitted).slots, [slotAt(0, "23:30")]);
  });

  it("요청에 섞인 지난 슬롯은 무시하고, 이미 저장된 지난 슬롯은 지우지 않는다", async () => {
    const { member, promiseId } = await setUp();
    await submit(member, promiseId, 0, [slotAt(0, "14:00"), slotAt(0, "15:00")]);
    await moveSlotToPast(slotAt(0, "14:00"));
    const before = (await getAvailability(member, promiseId)).body as { me: { slots: string[] } };
    const pastSlot = before.me.slots.find((s) => ms(s) < Date.now())!;

    const res = await submit(member, promiseId, 1, [pastSlot, slotAt(1, "10:00")]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 2, droppedSlotCount: 0 });
    sameInstants((res.body as Submitted).slots, [pastSlot, slotAt(1, "10:00")]);
  });

  it("같은 슬롯이 여러 번 와도 하나로 저장한다", async () => {
    const { member, promiseId } = await setUp();

    const res = await submit(member, promiseId, 0, [
      slotAt(0, "14:00"),
      slotAt(0, "14:00"),
      slotAt(0, "14:00").replace("+09:00", ".000+09:00"),
    ]);

    expect((res.body as Submitted).slots).toHaveLength(1);
  });

  it("가능한 시간이 없어도 제출할 수 있고, 다른 사람에게는 모든 시간에 불가능으로 보인다", async () => {
    const { host, member, promiseId } = await setUp();
    await submit(member, promiseId, 0, [slotAt(0, "14:00")]);

    const res = await submit(member, promiseId, 1, []);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ version: 2, submitted: true, slots: [] });
    const seenByHost = (await getAvailability(host, promiseId)).body as {
      participants: { nickname: string; availableSlots: string[] }[];
    };
    expect(seenByHost.participants.find((p) => p.nickname === "혜승")!.availableSlots).toEqual([]);
  });

  describe("기준 버전", () => {
    it("다른 기기가 먼저 제출해 버전이 다르면 409 AVAILABILITY_VERSION_CONFLICT와 최신 값을 돌려준다", async () => {
      const { member, promiseId } = await setUp();
      await submit(member, promiseId, 0, [slotAt(0, "14:00")]);

      const res = await submit(member, promiseId, 0, [slotAt(1, "10:00")]);

      expect(res.status).toBe(409);
      const body = res.body as {
        code: string;
        details: { currentVersion: number; submitted: boolean; slots: string[] };
      };
      expect(body.code).toBe("AVAILABILITY_VERSION_CONFLICT");
      expect(body.details).toMatchObject({ currentVersion: 1, submitted: true });
      sameInstants(body.details.slots, [slotAt(0, "14:00")]);
    });

    it("응답을 못 받고 같은 내용으로 다시 보내면 바꾸지 않고 200과 최신 버전을 돌려준다", async () => {
      const { member, promiseId } = await setUp();
      const first = (await submit(member, promiseId, 0, [slotAt(0, "14:00")])).body as Submitted;

      const retry = await submit(member, promiseId, 0, [slotAt(0, "14:00")]);

      expect(retry.status).toBe(200);
      expect(retry.body).toMatchObject({ version: 1, submittedAt: first.submittedAt });
    });
  });

  describe("입력 형식", () => {
    it("슬롯이 5,000개를 넘으면 422 SLOT_LIMIT_EXCEEDED", async () => {
      const { member, promiseId } = await setUp();

      const res = await submit(member, promiseId, 0, Array(5001).fill(slotAt(0, "14:00")));

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "SLOT_LIMIT_EXCEEDED" });
    });

    it.each([
      ["+09:00이 아닌 시각", slotAt(0, "14:00").replace("+09:00", "Z")],
      ["30분 경계가 아닌 시각", slotAt(0, "14:15")],
      ["없는 날짜", "2026-02-30T14:00:00+09:00"],
    ])("%s은 422 INVALID_SLOT_FORMAT", async (_name, slot) => {
      const { member, promiseId } = await setUp();

      const res = await submit(member, promiseId, 0, [slot]);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "INVALID_SLOT_FORMAT" });
    });

    it("기준 버전이나 슬롯이 없으면 400", async () => {
      const { member, promiseId } = await setUp();

      const res = await submitAvailability(member, promiseId, { slots: [] });

      expect(res.status).toBe(400);
    });
  });

  describe("마감과 권한", () => {
    it("마감 시각이 지났으면 409 VOTING_CLOSED이고 약속은 마감으로 보인다", async () => {
      const { host, member, promiseId } = await setUp();
      await passDeadline(promiseId);

      const res = await submit(member, promiseId, 0, [slotAt(0, "14:00")]);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "VOTING_CLOSED" });
      expect((await getPromise(host, promiseId)).body).toMatchObject({ promiseStatus: "closed" });
      // 조회는 계산만 하므로, 상태를 실제로 바꿔 커밋했는지는 DB로 확인한다(ADR-0001).
      expect(await storedPromiseStatus(promiseId)).toBe("closed");
    });

    it("방장이 설정 중(draft)이면 409 PROMISE_NOT_COLLECTING", async () => {
      const host = createTestClient();
      const { promiseId } = await createDraftPromise(host);

      const res = await submit(host, promiseId, 0, [slotAt(0, "14:00")]);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "PROMISE_NOT_COLLECTING" });
    });

    it("로그인하지 않은 사람은 제출할 수 없다(401)", async () => {
      const { promiseId } = await setUp();

      const res = await submit(createTestClient(), promiseId, 0, [slotAt(0, "14:00")]);

      expect(res.status).toBe(401);
    });

    it("탈퇴한 참여자는 세션이 남아 있어도 제출할 수 없다(401)", async () => {
      const { member, promiseId } = await setUp();
      await cancelParticipant(promiseId, "혜승");

      const res = await submit(member, promiseId, 0, [slotAt(0, "14:00")]);

      expect(res.status).toBe(401);
    });

    it("로그인하지 않았으면 요청 형식보다 먼저 401로 거부한다", async () => {
      const { promiseId } = await setUp();

      const res = await submitAvailability(createTestClient(), promiseId, { slots: "형식 오류" });

      expect(res.status).toBe(401);
    });

    it("방장도 참여자로서 제출할 수 있다", async () => {
      const { host, promiseId } = await setUp();

      const res = await submit(host, promiseId, 0, [slotAt(0, "14:00")]);

      expect(res.status).toBe(200);
    });
  });
});
