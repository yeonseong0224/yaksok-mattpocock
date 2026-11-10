import { describe, expect, it } from "vitest";
import { createTestClient } from "@/test/http";
import { passDeadline } from "@/test/db";
import {
  createCollectingPromise,
  createDraftPromise,
  getAvailability,
  registerParticipant,
  slotAt,
  submitAvailability,
} from "@/test/flows";

// TIME-API-02 가능 시간 현황

const KST_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/;

type Status = {
  status: string;
  serverTime: string;
  settings: Record<string, unknown>;
  totalParticipants: number;
  participants: { nickname: string; isHost: boolean; availableSlots: string[] }[];
  me: { version: number; submitted: boolean; slots: string[] };
};

describe("가능 시간 현황", () => {
  it("모든 active 참여자를 분모로 주고, 제출하지 않은 참여자는 모든 시간에 불가능으로 보인다", async () => {
    const host = createTestClient();
    const { promiseId } = await createCollectingPromise(host);
    const member = createTestClient();
    await registerParticipant(member, promiseId);
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: [slotAt(0, "14:00")] });

    const res = await getAvailability(host, promiseId);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = res.body as Status;
    expect(body.status).toBe("collecting");
    expect(body.serverTime).toMatch(KST_ISO);
    expect(body.settings).toMatchObject({
      dailyStartTime: "09:00",
      dailyEndTime: "24:00",
      durationMinutes: 120,
    });
    expect(body.totalParticipants).toBe(2);
    expect(body.participants.map((p) => [p.nickname, p.isHost, p.availableSlots.length])).toEqual([
      ["승주", true, 0],
      ["혜승", false, 1],
    ]);
    // 다른 참여자의 제출 여부는 응답에 없다(TIME-12-02).
    expect(JSON.stringify(body.participants)).not.toContain("submitted");
    expect(body.me).toMatchObject({ version: 0, submitted: false, slots: [] });
  });

  it("내 버전·제출 여부·저장 슬롯을 me로 알려준다", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    const member = createTestClient();
    await registerParticipant(member, promiseId);
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: [slotAt(0, "14:00")] });

    const res = await getAvailability(member, promiseId);

    const body = res.body as Status;
    expect(body.me).toMatchObject({ version: 1, submitted: true });
    expect(body.me.slots.map(Date.parse)).toEqual([Date.parse(slotAt(0, "14:00"))]);
  });

  it("마감 시각이 지나면 마감(closed)으로 보이고, 내 입력은 그대로 볼 수 있다", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    const member = createTestClient();
    await registerParticipant(member, promiseId);
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: [slotAt(0, "14:00")] });
    await passDeadline(promiseId);

    const res = await getAvailability(member, promiseId);

    expect(res.body).toMatchObject({ status: "closed", me: { submitted: true } });
  });

  it("등록하지 않은 사람은 볼 수 없다(401)", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());

    const res = await getAvailability(createTestClient(), promiseId);

    expect(res.status).toBe(401);
  });

  it("방장이 설정 중(draft)이면 409 PROMISE_NOT_COLLECTING", async () => {
    const host = createTestClient();
    const { promiseId } = await createDraftPromise(host);

    const res = await getAvailability(host, promiseId);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "PROMISE_NOT_COLLECTING" });
  });
});
