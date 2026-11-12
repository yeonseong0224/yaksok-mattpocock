import { describe, expect, it } from "vitest";
import { cookieMaxAge, createTestClient } from "@/test/http";
import { cancelParticipant, expireSessions, passDeadline } from "@/test/db";
import {
  createCollectingPromise,
  createDraftPromise,
  getMe,
  getPromise,
  logIn,
  logOut,
  registerParticipant,
} from "@/test/flows";

// MEMBER-API-04 재인증(로그인), MEMBER-API-07 로그아웃

const DAY_SECONDS = 24 * 60 * 60;

describe("로그인", () => {
  it("다른 기기에서 닉네임·PIN으로 같은 참여자로 로그인하고, 두 기기 모두 로그인 상태를 유지한다", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    const phone = createTestClient();
    const registered = await registerParticipant(phone, promiseId);
    const laptop = createTestClient();

    const res = await logIn(laptop, promiseId, { nickname: "  혜승 ", pin: "1357" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      participantId: (registered.body as { participantId: string }).participantId,
      nickname: "혜승",
      role: "member",
      status: "active",
      promiseStatus: "collecting",
    });
    expect((await getMe(laptop, promiseId)).status).toBe(200);
    expect((await getMe(phone, promiseId)).status).toBe(200);
  });

  it("PIN이 틀린 경우와 없는 닉네임은 똑같이 401 INVALID_CREDENTIALS", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    await registerParticipant(createTestClient(), promiseId);

    const wrongPin = await logIn(createTestClient(), promiseId, { nickname: "혜승", pin: "0000" });
    const unknown = await logIn(createTestClient(), promiseId, {
      nickname: "없는사람",
      pin: "1357",
    });

    expect(wrongPin.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPin.body).toEqual(unknown.body);
    expect(wrongPin.body).toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("방장은 설정 중(draft)에도 다른 기기에서 로그인해 설정을 이어 갈 수 있다", async () => {
    const { promiseId } = await createDraftPromise(createTestClient());
    const otherDevice = createTestClient();

    const res = await logIn(otherDevice, promiseId, { nickname: "승주", pin: "4827" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: "host", promiseStatus: "draft" });
    // draft 세션은 24시간
    expect(cookieMaxAge(res)).toBeGreaterThan(DAY_SECONDS - 60);
    expect(cookieMaxAge(res)).toBeLessThanOrEqual(DAY_SECONDS);
    expect((await getPromise(otherDevice, promiseId)).body).toHaveProperty("settings");
  });

  it("마감 + 7일이 지나 세션이 만료돼도 다시 로그인할 수 있고, 새 세션은 로그인 시각 + 7일까지다", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    const phone = createTestClient();
    await registerParticipant(phone, promiseId);
    await passDeadline(promiseId, "8 days");
    await expireSessions(promiseId);
    expect((await getMe(phone, promiseId)).status).toBe(401);

    const res = await logIn(phone, promiseId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ promiseStatus: "closed" });
    expect(cookieMaxAge(res)).toBeGreaterThan(7 * DAY_SECONDS - 60);
    expect(cookieMaxAge(res)).toBeLessThanOrEqual(7 * DAY_SECONDS);
    expect((await getMe(phone, promiseId)).status).toBe(200);
  });

  it("탈퇴한 참여자는 401 UNAUTHENTICATED(C-07)", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    await registerParticipant(createTestClient(), promiseId);
    await cancelParticipant(promiseId, "혜승");

    const res = await logIn(createTestClient(), promiseId);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("다른 사이트의 Origin이면 403", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    await registerParticipant(createTestClient(), promiseId);
    const { POST } = await import("./route");

    const res = await createTestClient().request(POST, {
      method: "POST",
      path: `/api/v1/promises/${promiseId}/auth/session`,
      params: { promiseId },
      body: { nickname: "혜승", pin: "1357" },
      headers: { origin: "https://evil.example" },
    });

    expect(res.status).toBe(403);
  });
});

describe("로그아웃", () => {
  it("이 기기의 로그인만 끝나고 다른 기기는 그대로이며, 다시 로그인할 수 있다", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    const phone = createTestClient();
    await registerParticipant(phone, promiseId);
    const laptop = createTestClient();
    await logIn(laptop, promiseId);

    const res = await logOut(phone, promiseId);

    expect(res.status).toBe(204);
    expect(
      phone.cookie(`ys_session_${promiseId}`, `/api/v1/promises/${promiseId}/me`),
    ).toBeUndefined();
    expect((await getMe(phone, promiseId)).status).toBe(401);
    expect((await getMe(laptop, promiseId)).status).toBe(200);
    expect((await logIn(phone, promiseId)).status).toBe(200);
  });

  it("버려진 세션 토큰으로는 더 이상 로그인 상태가 아니다", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());
    const phone = createTestClient();
    await registerParticipant(phone, promiseId);
    const token = phone.cookie(`ys_session_${promiseId}`, `/api/v1/promises/${promiseId}/me`)!;
    await logOut(phone, promiseId);

    const { GET } = await import("../../me/route");
    const res = await createTestClient().request(GET, {
      path: `/api/v1/promises/${promiseId}/me`,
      params: { promiseId },
      headers: { cookie: `ys_session_${promiseId}=${token}` },
    });

    expect(res.status).toBe(401);
  });

  it("없는 약속이면 404 PROMISE_NOT_FOUND", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const { DELETE } = await import("./route");

    const res = await createTestClient().request(DELETE, {
      method: "DELETE",
      path: `/api/v1/promises/${missing}/auth/session`,
      params: { promiseId: missing },
      headers: { cookie: `ys_session_${missing}=whatever` },
    });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "PROMISE_NOT_FOUND" });
  });

  it("로그인 상태가 아니면 401 UNAUTHENTICATED", async () => {
    const { promiseId } = await createCollectingPromise(createTestClient());

    const res = await logOut(createTestClient(), promiseId);

    expect(res.status).toBe(401);
  });
});
