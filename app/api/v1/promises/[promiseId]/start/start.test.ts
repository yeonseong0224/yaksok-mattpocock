import { describe, expect, it } from "vitest";
import { POST as start } from "./route";
import { cookieMaxAge, createTestClient } from "@/test/http";
import { ageDraft, insertMemberSession, passDeadline } from "@/test/db";
import {
  createDraftPromise,
  getPromise,
  lookUpLink,
  registerHost,
  startCollecting,
  validStartBody,
} from "@/test/flows";

// STATE-API-02 설정 완료와 모집 시작

const DAY_SECONDS = 24 * 60 * 60;

describe("모집 시작", () => {
  it("방장이 설정을 마치면 약속이 모집 중(collecting)이 되고 링크로 참여할 수 있다", async () => {
    const host = createTestClient();
    const { inviteToken, promiseId } = await createDraftPromise(host);
    const body = validStartBody({ title: "  팀 저녁 모임  " });

    const res = await startCollecting(host, promiseId, body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      promiseId,
      promiseStatus: "collecting",
      settings: {
        title: "팀 저녁 모임",
        participantLimit: 4,
        dateRange: body.dateRange,
        dailyTimeRange: { startTime: "09:00", endTime: "24:00" },
        durationMinutes: 120,
      },
    });
    const link = await lookUpLink(createTestClient(), inviteToken);
    expect(link.body).toMatchObject({
      promiseStatus: "collecting",
      nextAction: "join",
      pollAfterMs: null,
    });
  });

  it("모집을 시작하면 방장의 세션이 마감 + 7일까지 늘어난다", async () => {
    const host = createTestClient();
    const { promiseId } = await createDraftPromise(host);
    const body = validStartBody();

    const res = await startCollecting(host, promiseId, body);

    const expected = (Date.parse(body.votingDeadlineAt) - Date.now()) / 1000 + 7 * DAY_SECONDS;
    const maxAge = cookieMaxAge(res);
    expect(maxAge).toBeGreaterThan(expected - 60);
    expect(maxAge).toBeLessThanOrEqual(expected + 1);
    // 이후 응답도 늘어난 만료를 쿠키에 싣는다.
    const later = await getPromise(host, promiseId);
    expect(cookieMaxAge(later)).toBeGreaterThan(expected - 60);
  });

  it("어긋난 설정은 422로 거부하고 필드별 이유를 모두 알려준다", async () => {
    const host = createTestClient();
    const { promiseId } = await createDraftPromise(host);

    const res = await startCollecting(
      host,
      promiseId,
      validStartBody({ title: " ", participantLimit: 31 }),
    );

    expect(res.status).toBe(422);
    const body = res.body as { code: string; details: { errors: { field: string }[] } };
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.details.errors.map((e) => e.field)).toEqual(["title", "participantLimit"]);
    const promise = await getPromise(host, promiseId);
    expect(promise.body).toMatchObject({ promiseStatus: "draft" });
  });

  it.each([
    ["약속 이름", "title"],
    ["정원", "participantLimit"],
    ["날짜 범위", "dateRange"],
    ["마감", "votingDeadlineAt"],
  ])("%s이 빠지면 모집을 시작할 수 없다(400)", async (_name, field) => {
    const host = createTestClient();
    const { promiseId } = await createDraftPromise(host);
    const body: Record<string, unknown> = validStartBody();
    delete body[field];

    const res = await startCollecting(host, promiseId, body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("하루 시간 범위와 약속 길이를 보내도 기본값으로 저장한다", async () => {
    const host = createTestClient();
    const { promiseId } = await createDraftPromise(host);

    const res = await startCollecting(
      host,
      promiseId,
      validStartBody({
        dailyTimeRange: { startTime: "00:00", endTime: "12:00" },
        durationMinutes: 30,
      }),
    );

    expect(res.body).toMatchObject({
      settings: { dailyTimeRange: { startTime: "09:00", endTime: "24:00" }, durationMinutes: 120 },
    });
  });

  describe("권한", () => {
    it("로그인하지 않은 사람은 401 UNAUTHENTICATED", async () => {
      const { promiseId } = await createDraftPromise(createTestClient());

      const res = await startCollecting(createTestClient(), promiseId);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "UNAUTHENTICATED" });
    });

    it("멤버는 모집을 시작할 수 없다(403 FORBIDDEN)", async () => {
      const { promiseId } = await createDraftPromise(createTestClient());
      const memberToken = await insertMemberSession(promiseId);

      const res = await createTestClient().request(start, {
        method: "POST",
        path: `/api/v1/promises/${promiseId}/start`,
        params: { promiseId },
        body: validStartBody(),
        headers: { cookie: `ys_session_${promiseId}=${memberToken}` },
      });

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "FORBIDDEN" });
    });

    it("다른 약속의 방장 세션으로는 시작할 수 없다(401)", async () => {
      const host = createTestClient();
      await createDraftPromise(host);
      const { promiseId: otherPromiseId } = await createDraftPromise(createTestClient());

      const res = await startCollecting(host, otherPromiseId);

      expect(res.status).toBe(401);
    });

    it("다른 사이트의 Origin이면 403", async () => {
      const host = createTestClient();
      const { promiseId } = await createDraftPromise(host);

      const res = await host.request(start, {
        method: "POST",
        path: `/api/v1/promises/${promiseId}/start`,
        params: { promiseId },
        body: validStartBody(),
        headers: { origin: "https://evil.example" },
      });

      expect(res.status).toBe(403);
    });
  });

  it("이미 모집 중인 약속을 다시 시작하면 409 INVALID_PROMISE_STATE", async () => {
    const host = createTestClient();
    const { promiseId } = await createDraftPromise(host);
    await startCollecting(host, promiseId);

    const res = await startCollecting(host, promiseId);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "INVALID_PROMISE_STATE" });
  });

  describe("초안 10분 만료", () => {
    it("10분이 지난 뒤 시작하면 410 DRAFT_EXPIRED이고, 다음 사람이 새 방장이 될 수 있다", async () => {
      const host = createTestClient();
      const { inviteToken, promiseId } = await createDraftPromise(host);
      await ageDraft(promiseId, "10 minutes");

      const res = await startCollecting(host, promiseId);

      expect(res.status).toBe(410);
      expect(res.body).toMatchObject({ code: "DRAFT_EXPIRED" });
      expect((await getPromise(host, promiseId)).status).toBe(404);
      const next = await registerHost(createTestClient(), inviteToken, {
        nickname: "민수",
        pin: "1111",
      });
      expect(next.status).toBe(201);
    });

    it("9분 59초에는 아직 시작할 수 있다", async () => {
      const host = createTestClient();
      const { promiseId } = await createDraftPromise(host);
      await ageDraft(promiseId, "9 minutes 59 seconds");

      const res = await startCollecting(host, promiseId);

      expect(res.status).toBe(200);
    });

    it("만료된 초안의 링크로 새 방장이 등록하면 이전 초안은 지워진다", async () => {
      const oldHost = createTestClient();
      const { inviteToken, promiseId: oldPromiseId } = await createDraftPromise(oldHost);
      await ageDraft(oldPromiseId, "10 minutes");

      const next = await registerHost(createTestClient(), inviteToken, {
        nickname: "민수",
        pin: "1111",
      });

      expect(next.status).toBe(201);
      expect((next.body as { promiseId: string }).promiseId).not.toBe(oldPromiseId);
      expect((await getPromise(oldHost, oldPromiseId)).status).toBe(404);
      expect((await startCollecting(oldHost, oldPromiseId)).status).toBe(404);
    });
  });

  it("마감 시각이 지나면 조회 결과가 마감(closed)으로 보인다", async () => {
    const host = createTestClient();
    const { inviteToken, promiseId } = await createDraftPromise(host);
    await startCollecting(host, promiseId);
    await passDeadline(promiseId);

    const promise = await getPromise(host, promiseId);
    const link = await lookUpLink(createTestClient(), inviteToken);

    expect(promise.body).toMatchObject({ promiseStatus: "closed" });
    expect(link.body).toMatchObject({ promiseStatus: "closed", nextAction: "view_result" });
  });
});
