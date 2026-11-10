import { describe, expect, it } from "vitest";
import { cookieMaxAge, createTestClient } from "@/test/http";
import { passDeadline } from "@/test/db";
import {
  createCollectingPromise,
  createDraftPromise,
  getMe,
  getPromise,
  registerParticipant,
} from "@/test/flows";

// MEMBER-API-03 참여자 등록

describe("참여자 등록", () => {
  it("모집 중인 약속에 등록하면 멤버가 되고 바로 로그인된다", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    const guest = createTestClient();

    const res = await registerParticipant(guest, promiseId, { nickname: " 혜승 ", pin: "1357" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      nickname: "혜승",
      role: "member",
      status: "active",
      availabilitySubmittedAt: null,
      currentParticipantCount: 2,
      participantLimit: 4,
    });
    const me = await getMe(guest, promiseId);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ nickname: "혜승", role: "member" });
    // 등록해야 약속 설정이 보인다(MEMBER-08-01).
    const promise = await getPromise(guest, promiseId);
    expect(promise.body).toMatchObject({ settings: { title: "팀 저녁 모임" } });
  });

  it("등록 세션은 마감 + 7일에 만료된다", async () => {
    const host = createTestClient();
    const { promiseId } = await createCollectingPromise(host);
    const deadline = Date.parse(
      ((await getPromise(host, promiseId)).body as { settings: { votingDeadlineAt: string } })
        .settings.votingDeadlineAt,
    );

    const res = await registerParticipant(createTestClient(), promiseId);

    const maxAge = cookieMaxAge(res);
    const expected = (deadline - Date.now()) / 1000 + 7 * 24 * 60 * 60;
    expect(maxAge).toBeGreaterThan(expected - 60);
    expect(maxAge).toBeLessThanOrEqual(expected + 1);
  });

  it("한 약속의 세션은 다른 약속에서 쓰이지 않는다", async () => {
    const { promiseId: a } = await createCollectingPromise(createTestClient());
    const { promiseId: b } = await createCollectingPromise(createTestClient());
    const guest = createTestClient();
    await registerParticipant(guest, a);

    const me = await getMe(guest, b);

    expect(me.status).toBe(401);
  });

  describe("닉네임 중복", () => {
    it.each([
      ["같은 닉네임", "혜승"],
      ["앞뒤 공백만 다른 닉네임", "  혜승"],
      ["NFC 정규화하면 같은 닉네임", "혜승".normalize("NFD")],
      ["방장과 같은 닉네임", "승주"],
    ])("%s이면 409 NICKNAME_TAKEN", async (_name, nickname) => {
      const { promiseId } = await createCollectingPromise(createTestClient());
      await registerParticipant(createTestClient(), promiseId, { nickname: "혜승", pin: "1357" });

      const res = await registerParticipant(createTestClient(), promiseId, {
        nickname,
        pin: "2468",
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "NICKNAME_TAKEN" });
    });

    it("대소문자만 다른 닉네임은 다른 사람이다", async () => {
      const { promiseId } = await createCollectingPromise(createTestClient());
      await registerParticipant(createTestClient(), promiseId, {
        nickname: "Chulsoo",
        pin: "1357",
      });

      const res = await registerParticipant(createTestClient(), promiseId, {
        nickname: "chulsoo",
        pin: "1357",
      });

      expect(res.status).toBe(201);
    });
  });

  describe("정원", () => {
    it("정원이 다 차면 409 PROMISE_FULL", async () => {
      const { promiseId } = await createCollectingPromise(createTestClient(), {
        participantLimit: 2,
      });
      await registerParticipant(createTestClient(), promiseId, { nickname: "혜승", pin: "1357" });

      const res = await registerParticipant(createTestClient(), promiseId, {
        nickname: "철수",
        pin: "2468",
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "PROMISE_FULL" });
    });

    it("마지막 자리에 동시에 등록하면 한 명만 들어간다", async () => {
      const { promiseId } = await createCollectingPromise(createTestClient(), {
        participantLimit: 2,
      });

      const results = await Promise.all(
        ["혜승", "철수", "영희"].map((nickname) =>
          registerParticipant(createTestClient(), promiseId, { nickname, pin: "1357" }),
        ),
      );

      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    });
  });

  describe("약속 상태", () => {
    it("방장이 설정 중(draft)이면 409 PROMISE_NOT_OPEN", async () => {
      const { promiseId } = await createDraftPromise(createTestClient());

      const res = await registerParticipant(createTestClient(), promiseId);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "PROMISE_NOT_OPEN" });
    });

    it("마감 시각이 지났으면 409 DEADLINE_PASSED이고 약속은 마감으로 보인다", async () => {
      const host = createTestClient();
      const { promiseId } = await createCollectingPromise(host);
      await passDeadline(promiseId);

      const res = await registerParticipant(createTestClient(), promiseId);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: "DEADLINE_PASSED" });
      expect((await getPromise(host, promiseId)).body).toMatchObject({ promiseStatus: "closed" });
    });

    it("없는 약속은 404", async () => {
      const res = await registerParticipant(
        createTestClient(),
        "00000000-0000-4000-8000-000000000000",
      );

      expect(res.status).toBe(404);
    });
  });

  it("닉네임·PIN 규칙을 어기면 422", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());

    const res = await registerParticipant(createTestClient(), promiseId, {
      nickname: "혜승",
      pin: "12",
    });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", details: { field: "pin" } });
  });
});
