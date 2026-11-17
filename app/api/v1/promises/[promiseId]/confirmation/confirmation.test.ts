import { describe, expect, it } from "vitest";
import { createTestClient, type TestClient } from "@/test/http";
import { cancelParticipant, passDeadline } from "@/test/db";
import {
  closePromise,
  confirmPromise,
  createCollectingPromise,
  getPromise,
  registerParticipant,
  slotAt,
  submitAvailability,
} from "@/test/flows";

// STATE-API-05 확정(RESULT-11-02·12-01·12-02·13-01·13-02, STATE-07-01, candidate-blocks 03)

// 약속 길이 2시간. 14:00~16:00 후보에는 14:00·14:30·15:00·15:30이 모두 필요하다.
const from14to16 = [slotAt(0, "14:00"), slotAt(0, "14:30"), slotAt(0, "15:00"), slotAt(0, "15:30")];
const from14to17 = [...from14to16, slotAt(0, "16:00"), slotAt(0, "16:30")];
const ms = (iso: string) => Date.parse(iso);

type Confirmation = {
  startAt: string;
  endAt: string;
  availableParticipantCount: number;
  participants: { nickname: string }[];
  hostActionRequired: boolean;
};

async function setUp() {
  const host = createTestClient();
  const { promiseId } = await createCollectingPromise(host);
  const member = createTestClient();
  await registerParticipant(member, promiseId);
  return { host, member, promiseId };
}

async function submit(client: TestClient, promiseId: string, slots: string[]) {
  const res = await submitAvailability(client, promiseId, { baseVersion: 0, slots });
  expect(res.status).toBe(200);
}

describe("확정", () => {
  it("방장이 마감된 약속에서 후보 블록의 창을 고르면 확정되고, 모두가 시작·끝과 참석 가능한 사람을 본다", async () => {
    const { host, member, promiseId } = await setUp();
    await submit(host, promiseId, from14to16);
    await submit(member, promiseId, from14to16);
    await closePromise(host, promiseId);

    const res = await confirmPromise(host, promiseId, slotAt(0, "14:00"));

    expect(res.status).toBe(200);
    const body = res.body as { promiseStatus: string; currentConfirmation: Confirmation };
    expect(body.promiseStatus).toBe("confirmed");
    expect(ms(body.currentConfirmation.startAt)).toBe(ms(slotAt(0, "14:00")));
    expect(ms(body.currentConfirmation.endAt)).toBe(ms(slotAt(0, "16:00")));

    const seen = (await getPromise(member, promiseId)).body as {
      promiseStatus: string;
      currentConfirmation: Confirmation;
    };
    expect(seen.promiseStatus).toBe("confirmed");
    expect(ms(seen.currentConfirmation.endAt)).toBe(ms(slotAt(0, "16:00")));
    expect(seen.currentConfirmation.availableParticipantCount).toBe(2);
    expect(seen.currentConfirmation.participants.map((p) => p.nickname).sort()).toEqual([
      "승주",
      "혜승",
    ]);
  });

  it("확정 뒤 참석 가능한 사람은 현재 제출값으로 다시 계산하고, 2명 미만이 돼도 확정은 그대로다", async () => {
    const { host, member, promiseId } = await setUp();
    await submit(host, promiseId, from14to16);
    await submit(member, promiseId, from14to16);
    await closePromise(host, promiseId);
    await confirmPromise(host, promiseId, slotAt(0, "14:00"));

    await cancelParticipant(promiseId, "혜승");

    const seen = (await getPromise(host, promiseId)).body as {
      promiseStatus: string;
      currentConfirmation: Confirmation;
    };
    expect(seen.promiseStatus).toBe("confirmed");
    expect(seen.currentConfirmation.participants.map((p) => p.nickname)).toEqual(["승주"]);
    // 방장에게는 참석 인원이 줄었다는 것을 알린다(STATE-API-01 hostActionRequired).
    expect(seen.currentConfirmation.hostActionRequired).toBe(true);
  });

  it("방장이 참석할 수 없는 후보도 확정할 수 있다(RESULT-04-02)", async () => {
    const { host, member, promiseId } = await setUp();
    const third = createTestClient();
    await registerParticipant(third, promiseId, { nickname: "철수", pin: "2468" });
    await submit(member, promiseId, from14to16);
    await submit(third, promiseId, from14to16);
    await closePromise(host, promiseId);

    const res = await confirmPromise(host, promiseId, slotAt(0, "14:00"));

    expect(res.status).toBe(200);
  });

  it("블록 안이면 최적 창이 아닌 시작 시각(30분씩 옮긴 창)도 확정할 수 있다", async () => {
    const { host, member, promiseId } = await setUp();
    await submit(host, promiseId, from14to17);
    await submit(member, promiseId, from14to17);
    await closePromise(host, promiseId);
    // 블록은 14:00~17:00. 최적 창은 14:00이지만 14:30~16:30, 15:00~17:00도 고를 수 있다.

    const res = await confirmPromise(host, promiseId, slotAt(0, "15:00"));

    expect(res.status).toBe(200);
    const body = res.body as { currentConfirmation: Confirmation };
    expect(ms(body.currentConfirmation.startAt)).toBe(ms(slotAt(0, "15:00")));
    expect(ms(body.currentConfirmation.endAt)).toBe(ms(slotAt(0, "17:00")));
  });

  describe("다시 계산해서 확정할 수 없는 창이면 409와 새 후보 블록", () => {
    it("창 끝이 블록을 넘는 시작 시각은 확정할 수 없다", async () => {
      const { host, member, promiseId } = await setUp();
      await submit(host, promiseId, from14to17);
      await submit(member, promiseId, from14to17);
      await closePromise(host, promiseId);

      const res = await confirmPromise(host, promiseId, slotAt(0, "15:30"));

      expect(res.status).toBe(409);
      const body = res.body as {
        code: string;
        details: { blocks: { startAt: string; endAt: string; selectable: boolean }[] };
      };
      expect(body.code).toBe("INVALID_CONFIRMATION_CANDIDATE");
      expect(body.details.blocks.map((b) => [ms(b.startAt), ms(b.endAt), b.selectable])).toEqual([
        [ms(slotAt(0, "14:00")), ms(slotAt(0, "17:00")), true],
      ]);
      expect((await getPromise(host, promiseId)).body).toMatchObject({ promiseStatus: "closed" });
    });

    it("본 뒤에 한 명이 빠져 2명 미만이 된 창은 확정할 수 없다", async () => {
      const { host, member, promiseId } = await setUp();
      await submit(host, promiseId, from14to16);
      await submit(member, promiseId, from14to16);
      await closePromise(host, promiseId);
      await cancelParticipant(promiseId, "혜승");

      const res = await confirmPromise(host, promiseId, slotAt(0, "14:00"));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: "INVALID_CONFIRMATION_CANDIDATE",
        details: { blocks: [] },
      });
    });

    it("가능 인원만 바뀌고 여전히 확정할 수 있는 창이면 그대로 확정한다(RESULT-12-02)", async () => {
      const { host, member, promiseId } = await setUp();
      const third = createTestClient();
      await registerParticipant(third, promiseId, { nickname: "철수", pin: "2468" });
      await submit(host, promiseId, from14to16);
      await submit(member, promiseId, from14to16);
      await submit(third, promiseId, from14to16);
      await closePromise(host, promiseId);
      await cancelParticipant(promiseId, "철수"); // 3명 → 2명

      const res = await confirmPromise(host, promiseId, slotAt(0, "14:00"));

      expect(res.status).toBe(200);
    });
  });

  describe("상태와 권한", () => {
    it("모집 중에는 먼저 조기 마감하라고 409로 거부한다(STATE-07-01)", async () => {
      const { host, member, promiseId } = await setUp();
      await submit(host, promiseId, from14to16);
      await submit(member, promiseId, from14to16);

      const res = await confirmPromise(host, promiseId, slotAt(0, "14:00"));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "INVALID_PROMISE_STATE" });
      expect((res.body as { message: string }).message).toContain("조기 마감");
    });

    it("마감 시각이 이미 지난 모집은 마감으로 보고 확정할 수 있다", async () => {
      const { host, member, promiseId } = await setUp();
      await submit(host, promiseId, from14to16);
      await submit(member, promiseId, from14to16);
      await passDeadline(promiseId);

      const res = await confirmPromise(host, promiseId, slotAt(0, "14:00"));

      expect(res.status).toBe(200);
    });

    it("이미 확정된 약속은 다시 확정할 수 없다(409)", async () => {
      const { host, member, promiseId } = await setUp();
      await submit(host, promiseId, from14to16);
      await submit(member, promiseId, from14to16);
      await closePromise(host, promiseId);
      await confirmPromise(host, promiseId, slotAt(0, "14:00"));

      const res = await confirmPromise(host, promiseId, slotAt(0, "14:00"));

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "INVALID_PROMISE_STATE" });
    });

    it("멤버는 확정할 수 없다(403)", async () => {
      const { host, member, promiseId } = await setUp();
      await submit(host, promiseId, from14to16);
      await submit(member, promiseId, from14to16);
      await closePromise(host, promiseId);

      const res = await confirmPromise(member, promiseId, slotAt(0, "14:00"));

      expect(res.status).toBe(403);
      expect((await getPromise(host, promiseId)).body).toMatchObject({ promiseStatus: "closed" });
    });

    it("로그인하지 않은 사람은 확정할 수 없다(401)", async () => {
      const { host, promiseId } = await setUp();
      await closePromise(host, promiseId);

      const res = await confirmPromise(createTestClient(), promiseId, slotAt(0, "14:00"));

      expect(res.status).toBe(401);
    });

    it.each([
      ["시각이 아닌 값", "내일 오후"],
      ["오프셋 없는 시각", slotAt(0, "14:00").replace("+09:00", "")],
      ["숫자", 1234],
    ])("%s은 422 VALIDATION_FAILED", async (_name, startAt) => {
      const { host, promiseId } = await setUp();
      await closePromise(host, promiseId);

      const res = await confirmPromise(host, promiseId, startAt);

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "VALIDATION_FAILED" });
    });
  });
});
