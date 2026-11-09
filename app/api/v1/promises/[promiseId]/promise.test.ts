import { describe, expect, it } from "vitest";
import { createTestClient } from "@/test/http";
import { ageDraft } from "@/test/db";
import { createDraftPromise, getPromise, lookUpLink, startCollecting } from "@/test/flows";

// STATE-API-01 약속 상태·설정 조회

const KST_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/;

describe("약속 상태·설정 조회", () => {
  it("방장은 설정 중(draft)인 약속의 빈 설정과 초안 만료 시각을 본다", async () => {
    const host = createTestClient();
    const { promiseId } = await createDraftPromise(host);

    const res = await getPromise(host, promiseId);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toMatchObject({
      promiseId,
      promiseStatus: "draft",
      draftExpired: false,
      settings: {
        title: null,
        participantLimit: null,
        dateRange: { startDate: null, endDate: null },
        dailyTimeRange: { startTime: null, endTime: null },
        durationMinutes: null,
        votingDeadlineAt: null,
      },
      currentConfirmation: null,
    });
    expect(body.draftExpiresAt).toMatch(KST_ISO);
  });

  it("로그인하지 않은 사람은 약속 상태만 본다", async () => {
    const { promiseId } = await createDraftPromise(createTestClient());

    const res = await getPromise(createTestClient(), promiseId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ promiseId, promiseStatus: "draft" });
  });

  it("모집 중인 약속의 설정은 하루 시간 범위를 HH:mm, 마감을 +09:00으로 보여준다", async () => {
    const host = createTestClient();
    const { promiseId } = await createDraftPromise(host);
    const started = await startCollecting(host, promiseId);
    expect(started.status).toBe(200);

    const res = await getPromise(host, promiseId);

    const body = res.body as { settings: Record<string, unknown> };
    expect(body).toMatchObject({
      promiseStatus: "collecting",
      draftExpiresAt: null,
      draftExpired: false,
      settings: {
        title: "팀 저녁 모임",
        participantLimit: 4,
        dailyTimeRange: { startTime: "09:00", endTime: "24:00" },
        durationMinutes: 120,
      },
    });
    expect(body.settings.votingDeadlineAt).toMatch(KST_ISO);
  });

  it("초안이 10분 지나면 만료로 보이지만, 조회만으로는 지워지지 않는다", async () => {
    const host = createTestClient();
    const { inviteToken, promiseId } = await createDraftPromise(host);
    await ageDraft(promiseId, "10 minutes");

    const res = await getPromise(host, promiseId);
    const again = await getPromise(host, promiseId);

    expect(res.body).toMatchObject({ promiseStatus: "draft", draftExpired: true });
    expect(again.status).toBe(200);
    // 링크를 연 다른 사람에게는 새 방장으로 등록할 수 있는 링크로 보인다.
    const link = await lookUpLink(createTestClient(), inviteToken);
    expect(link.body).toMatchObject({
      promiseStatus: "unclaimed",
      promiseId: null,
      nextAction: "register_host",
    });
  });

  it("없는 약속은 404 PROMISE_NOT_FOUND", async () => {
    const res = await getPromise(createTestClient(), "00000000-0000-4000-8000-000000000000");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "PROMISE_NOT_FOUND" });
  });

  it("UUID가 아닌 약속 ID는 400 INVALID_REQUEST", async () => {
    const res = await getPromise(createTestClient(), "not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
