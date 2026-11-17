import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { cookieMaxAge, createTestClient } from "@/test/http";
import {
  cancelPromise,
  closePromise,
  confirmPromise,
  createCollectingPromise,
  createDraftPromise,
  getCandidates,
  getMe,
  getPromise,
  getRoster,
  leavePromise,
  logIn,
  lookUpLink,
  registerParticipant,
  slotAt,
  submitAvailability,
} from "@/test/flows";

// STATE-API-08 본인 탈퇴와 방장 자동 승계(약속 관리 티켓 06).

const twoHoursFrom14 = ["14:00", "14:30", "15:00", "15:30"].map((t) => slotAt(0, t));
const HYESEUNG = { nickname: "혜승", pin: "1357" };
const MINSU = { nickname: "민수", pin: "2468" };

async function setUp() {
  const host = createTestClient();
  const { promiseId, inviteToken } = await createCollectingPromise(host);
  const member = createTestClient();
  await registerParticipant(member, promiseId, HYESEUNG);
  return { host, member, promiseId, inviteToken };
}

const nicknamesOf = async (client: ReturnType<typeof createTestClient>, promiseId: string) =>
  (
    (await getRoster(client, promiseId)).body as { participants: { nickname: string }[] }
  ).participants.map((p) => p.nickname);

describe("본인 탈퇴", () => {
  it("멤버가 나가면 cancelled가 되고 세션이 끝나며, 명단·후보에서 빠지지만 입력 기록은 남는다", async () => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });

    const res = await leavePromise(member, promiseId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      promiseId,
      promiseStatus: "collecting",
      participantStatus: "cancelled",
      hostTransferred: false,
      newHostParticipantId: null,
      promiseCancelledAt: null,
    });
    expect((res.body as { participantCancelledAt: string }).participantCancelledAt).toMatch(
      /\+09:00$/,
    );
    expect(cookieMaxAge(res)).toBe(0);
    expect((await getMe(member, promiseId)).status).toBe(401);
    expect(await nicknamesOf(host, promiseId)).toEqual(["승주"]);
    expect((await getCandidates(host, promiseId)).body).toMatchObject({ blocks: [] });
    const row = await prisma.participant.findFirstOrThrow({
      where: { promiseId, nickname: "혜승" },
      include: { availableSlots: true },
    });
    expect(row.availableSlots).toHaveLength(4);
  });

  it("나간 사람은 다시 로그인하면 401 UNAUTHENTICATED이고, 같은 닉네임으로 다시 참여할 수 없다", async () => {
    const { member, promiseId } = await setUp();
    await leavePromise(member, promiseId);

    const login = await logIn(createTestClient(), promiseId, HYESEUNG);
    expect(login.status).toBe(401);
    expect(login.body).toMatchObject({ code: "UNAUTHENTICATED" });
    const again = await registerParticipant(createTestClient(), promiseId, HYESEUNG);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "NICKNAME_TAKEN" });
  });

  it("나간 자리는 정원에서 빠져 다른 사람이 들어올 수 있다", async () => {
    const host = createTestClient();
    const { promiseId } = await createCollectingPromise(host, { participantLimit: 2 });
    const member = createTestClient();
    await registerParticipant(member, promiseId, HYESEUNG);
    expect((await registerParticipant(createTestClient(), promiseId, MINSU)).status).toBe(409);

    await leavePromise(member, promiseId);

    expect((await registerParticipant(createTestClient(), promiseId, MINSU)).status).toBe(201);
  });

  it("확정 뒤에 나가면 확정 시각은 그대로고 참석 명단만 바뀌며, 2명 미만이면 방장에게 알린다", async () => {
    const { host, member, promiseId } = await setUp();
    await submitAvailability(host, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await submitAvailability(member, promiseId, { baseVersion: 0, slots: twoHoursFrom14 });
    await closePromise(host, promiseId);
    await confirmPromise(host, promiseId, twoHoursFrom14[0]);

    const res = await leavePromise(member, promiseId);

    expect(res.body).toMatchObject({ promiseStatus: "confirmed", participantStatus: "cancelled" });
    const view = (await getPromise(host, promiseId)).body as {
      promiseStatus: string;
      currentConfirmation: {
        startAt: string;
        participants: { nickname: string }[];
        hostActionRequired: boolean;
      };
    };
    expect(view.promiseStatus).toBe("confirmed");
    expect(Date.parse(view.currentConfirmation.startAt)).toBe(Date.parse(twoHoursFrom14[0]));
    expect(view.currentConfirmation.participants.map((p) => p.nickname)).toEqual(["승주"]);
    expect(view.currentConfirmation.hostActionRequired).toBe(true);
  });
});

describe("마감 뒤 탈퇴", () => {
  it("마감된 약속에서도 나갈 수 있고 약속은 마감 그대로다", async () => {
    const { host, member, promiseId } = await setUp();
    await closePromise(host, promiseId);

    const res = await leavePromise(member, promiseId);

    expect(res.body).toMatchObject({ promiseStatus: "closed", participantStatus: "cancelled" });
  });
});

describe("방장 자동 승계", () => {
  it("방장이 나가면 가장 먼저 들어온 active 참여자가 방장이 되고, 새 방장은 방장 작업을 할 수 있다", async () => {
    const { host, member, promiseId } = await setUp();
    const later = createTestClient();
    await registerParticipant(later, promiseId, MINSU);
    const firstId = ((await getMe(member, promiseId)).body as { participantId: string })
      .participantId;

    const res = await leavePromise(host, promiseId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      promiseStatus: "collecting",
      participantStatus: "cancelled",
      hostTransferred: true,
      newHostParticipantId: firstId,
      promiseCancelledAt: null,
    });
    expect((await getMe(member, promiseId)).body).toMatchObject({ role: "host" });
    expect((await getMe(later, promiseId)).body).toMatchObject({ role: "member" });
    const oldHost = await prisma.participant.findFirstOrThrow({
      where: { promiseId, nickname: "승주" },
    });
    expect([oldHost.role, oldHost.status]).toEqual(["member", "cancelled"]);
    expect((await closePromise(member, promiseId)).status).toBe(200);
  });

  it("승계 뒤 이전 방장은 세션이 끝나 방장 작업도 다시 로그인도 할 수 없다", async () => {
    const { host, promiseId } = await setUp();
    await leavePromise(host, promiseId);

    // 탈퇴 응답이 이 기기의 쿠키를 지우지만, 다른 기기의 세션도 서버에서 만료됐다.
    const other = createTestClient();
    expect((await logIn(other, promiseId, { nickname: "승주", pin: "4827" })).status).toBe(401);
    expect((await closePromise(host, promiseId)).status).toBe(401);
  });

  it("남은 사람이 없는 방장이 나가면 약속이 취소되고, 방장 기록은 host·active로 남는다", async () => {
    const host = createTestClient();
    const { promiseId, inviteToken } = await createCollectingPromise(host);

    const res = await leavePromise(host, promiseId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      promiseStatus: "cancelled",
      participantStatus: "active",
      participantCancelledAt: null,
      hostTransferred: false,
      newHostParticipantId: null,
    });
    expect((res.body as { promiseCancelledAt: string }).promiseCancelledAt).toMatch(/\+09:00$/);
    expect(cookieMaxAge(res)).toBe(0);
    expect((await lookUpLink(createTestClient(), inviteToken)).body).toMatchObject({
      promiseStatus: "cancelled",
    });
    const row = await prisma.participant.findFirstOrThrow({ where: { promiseId } });
    expect([row.role, row.status]).toEqual(["host", "active"]);
  });

  it("방장과 다음 순번이 동시에 나가도 한 줄로 처리돼, 결국 남은 사람이 없어 약속이 취소된다", async () => {
    const { host, member, promiseId } = await setUp();

    const results = await Promise.all([
      leavePromise(host, promiseId),
      leavePromise(member, promiseId),
    ]);

    // 늦게 처리된 쪽은 승계 뒤의 방장이거나, 후임 없는 방장이다. 어느 순서든 약속은 취소된다.
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const row = await prisma.promise.findUniqueOrThrow({ where: { id: promiseId } });
    expect(row.status).toBe("cancelled");
    const active = await prisma.participant.count({
      where: { promiseId, status: "active", role: "host" },
    });
    expect(active).toBe(1);
  });
});

describe("설정 중 초안 없애기", () => {
  it("draft에서 방장이 나가면 초안이 지워지고 링크가 처음 상태로 돌아간다", async () => {
    const host = createTestClient();
    const { promiseId, inviteToken } = await createDraftPromise(host);

    const res = await leavePromise(host, promiseId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: "draft_discarded", promiseId: null });
    expect(cookieMaxAge(res)).toBe(0);
    expect(await prisma.promise.findUnique({ where: { id: promiseId } })).toBeNull();
    expect((await lookUpLink(createTestClient(), inviteToken)).body).toMatchObject({
      promiseStatus: "unclaimed",
      promiseId: null,
    });
  });
});

describe("거절", () => {
  it("취소된 약속은 409 PROMISE_CANCELLED", async () => {
    const { host, member, promiseId } = await setUp();
    await cancelPromise(host, promiseId);

    const res = await leavePromise(member, promiseId);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "PROMISE_CANCELLED" });
  });

  it("로그인하지 않았으면 401", async () => {
    const { promiseId } = await setUp();

    expect((await leavePromise(createTestClient(), promiseId)).status).toBe(401);
  });
});
