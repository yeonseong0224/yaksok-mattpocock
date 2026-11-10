import { describe, expect, it } from "vitest";
import { createTestClient } from "@/test/http";
import { cancelParticipant } from "@/test/db";
import {
  closePromise,
  createCollectingPromise,
  createDraftPromise,
  getCandidates,
  registerParticipant,
  slotAt,
  submitAvailability,
} from "@/test/flows";

// 후보 조회(STATE-API-10, RESULT-08-01·09-01·09-02·10-01). 계산 규칙 자체는 후보 계산 모듈의 단위 테스트가 본다.

type Candidates = {
  promiseStatus: string;
  calculatedAt: string;
  candidates: {
    startAt: string;
    endAt: string;
    availableParticipantCount: number;
    participants: { nickname: string }[];
  }[];
};

const ms = (iso: string) => Date.parse(iso);
// 약속 길이 2시간 → 14:00~16:00 후보에는 14:00·14:30·15:00·15:30 슬롯이 모두 필요하다.
const twoHoursFrom14 = [
  slotAt(0, "14:00"),
  slotAt(0, "14:30"),
  slotAt(0, "15:00"),
  slotAt(0, "15:30"),
];

async function setUp() {
  const host = createTestClient();
  const { promiseId } = await createCollectingPromise(host);
  const member = createTestClient();
  await registerParticipant(member, promiseId);
  return { host, member, promiseId };
}

describe("후보 조회", () => {
  it("모집 중에도 제출값 기준의 후보와 참석 가능한 사람의 닉네임을 보여준다", async () => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });

    const res = await getCandidates(member, promiseId);

    expect(res.status).toBe(200);
    const body = res.body as Candidates;
    expect(body.promiseStatus).toBe("collecting");
    expect(body.calculatedAt).toMatch(/\.\d{3}\+09:00$/);
    expect(body.candidates).toHaveLength(1);
    const [candidate] = body.candidates;
    expect(ms(candidate.startAt)).toBe(ms(slotAt(0, "14:00")));
    expect(ms(candidate.endAt)).toBe(ms(slotAt(0, "16:00")));
    expect(candidate.availableParticipantCount).toBe(2);
    expect(candidate.participants.map((p) => p.nickname).sort()).toEqual(["승주", "혜승"]);
  });

  it("마감되면 같은 계산으로 최종 후보를 바로 보여준다", async () => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await closePromise(host, promiseId);

    const res = await getCandidates(member, promiseId);

    const body = res.body as Candidates;
    expect(body.promiseStatus).toBe("closed");
    expect(body.candidates).toHaveLength(1);
  });

  it("제출하지 않은 선택과 탈퇴한 참여자의 슬롯은 후보에 들어가지 않는다", async () => {
    const { host, member, promiseId } = await setUp();
    const leaver = createTestClient();
    await registerParticipant(leaver, promiseId, { nickname: "탈퇴자", pin: "1111" });
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await submitAvailability(leaver, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await cancelParticipant(promiseId, "탈퇴자");
    // 혜승은 제출하지 않았다.

    const res = await getCandidates(member, promiseId);

    // 남은 제출자는 방장 한 명뿐이라 2명 이상인 후보가 없다.
    expect((res.body as Candidates).candidates).toEqual([]);
  });

  it("2명 이상 겹치는 시간이 없으면 빈 목록이다(오류가 아니다)", async () => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: [slotAt(1, "10:00")] });

    const res = await getCandidates(host, promiseId);

    expect(res.status).toBe(200);
    expect((res.body as Candidates).candidates).toEqual([]);
  });

  it("등록하지 않은 사람은 후보를 볼 수 없다(401)", async () => {
    const { promiseId } = await setUp();

    const res = await getCandidates(createTestClient(), promiseId);

    expect(res.status).toBe(401);
  });

  it("설정 중(draft)인 약속은 409 INVALID_PROMISE_STATE", async () => {
    const host = createTestClient();
    const { promiseId } = await createDraftPromise(host);

    const res = await getCandidates(host, promiseId);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "INVALID_PROMISE_STATE" });
  });
});
