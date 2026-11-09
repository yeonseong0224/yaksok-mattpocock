import { describe, expect, it } from "vitest";
import { POST as issueLink } from "../../route";
import { GET as lookUpLink } from "../route";
import { POST as registerHost } from "./route";
import { createTestClient, type TestClient } from "@/test/http";
import { ageLink } from "@/test/db";

async function issue(client: TestClient): Promise<string> {
  const res = await client.request(issueLink, { method: "POST", path: "/api/v1/links" });
  return (res.body as { inviteToken: string }).inviteToken;
}

function register(client: TestClient, inviteToken: string, body: unknown) {
  return client.request(registerHost, {
    method: "POST",
    path: `/api/v1/links/${inviteToken}/host`,
    params: { inviteToken },
    body,
  });
}

function lookUp(client: TestClient, inviteToken: string) {
  return client.request(lookUpLink, {
    path: `/api/v1/links/${inviteToken}`,
    params: { inviteToken },
  });
}

const KST_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/;

describe("방장 등록", () => {
  it("처음 등록에 성공한 사람이 방장이 되고 draft 약속이 생긴다", async () => {
    const client = createTestClient();
    const inviteToken = await issue(client);

    const res = await register(client, inviteToken, { nickname: "승주", pin: "4827" });

    expect(res.status).toBe(201);
    const body = res.body as Record<string, string>;
    expect(body).toMatchObject({ nickname: "승주", role: "host", promiseStatus: "draft" });
    expect(body.promiseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.participantId).toMatch(/^[0-9a-f-]{36}$/);

    // 초안은 생성 후 10분 안에 설정을 마쳐야 한다(STATE-02-02)
    expect(body.draftExpiresAt).toMatch(KST_ISO);
    const minutesLeft = (Date.parse(body.draftExpiresAt) - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(9);
    expect(minutesLeft).toBeLessThanOrEqual(10);
  });

  it("방장 등록에 성공하면 그 약속 경로 전용 세션 쿠키로 로그인된다", async () => {
    const client = createTestClient();
    const inviteToken = await issue(client);

    const res = await register(client, inviteToken, { nickname: "승주", pin: "4827" });

    const { promiseId } = res.body as { promiseId: string };
    const promisePath = `/api/v1/promises/${promiseId}`;
    expect(client.cookie(`ys_session_${promiseId}`, `${promisePath}/me`)).toBeTruthy();
    expect(
      client.cookie(`ys_session_${promiseId}`, `/api/v1/links/${inviteToken}`),
    ).toBeUndefined();

    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toContain(`Path=${promisePath}`);
    // draft에서 발급한 세션은 24시간 뒤 만료(MEMBER-06-03)
    expect(setCookie).toContain("Max-Age=86400");
  });

  it("방장이 등록된 링크는 설정 중 상태로 보인다", async () => {
    const client = createTestClient();
    const inviteToken = await issue(client);
    const registered = await register(client, inviteToken, { nickname: "승주", pin: "4827" });

    const res = await lookUp(createTestClient(), inviteToken);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      inviteToken,
      promiseStatus: "draft",
      promiseId: (registered.body as { promiseId: string }).promiseId,
      nextAction: "wait_setup",
      pollAfterMs: 3000,
    });
  });

  it("이미 방장이 있는 링크에 등록하면 409 HOST_ALREADY_REGISTERED", async () => {
    const inviteToken = await issue(createTestClient());
    await register(createTestClient(), inviteToken, { nickname: "승주", pin: "4827" });

    const res = await register(createTestClient(), inviteToken, { nickname: "민수", pin: "1111" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "HOST_ALREADY_REGISTERED" });
  });

  it("두 명이 동시에 등록하면 한 명만 방장이 되고 다른 한 명은 409를 받는다", async () => {
    const inviteToken = await issue(createTestClient());
    const nicknames = ["승주", "민수", "연성", "혜승", "철수"];

    const results = await Promise.all(
      nicknames.map((nickname) =>
        register(createTestClient(), inviteToken, { nickname, pin: "1234" }),
      ),
    );

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    const winner = results.find((r) => r.status === 201)!.body as { promiseId: string };
    const link = await lookUp(createTestClient(), inviteToken);
    expect(link.body).toMatchObject({ promiseStatus: "draft", promiseId: winner.promiseId });
  });

  it("없는 링크에는 등록할 수 없다(404)", async () => {
    const res = await register(createTestClient(), "no-such-token", {
      nickname: "승주",
      pin: "4827",
    });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "LINK_NOT_FOUND" });
  });

  it("3개월이 지난 링크에는 등록할 수 없다(410)", async () => {
    const inviteToken = await issue(createTestClient());
    await ageLink(inviteToken, "3 months 1 minute");

    const res = await register(createTestClient(), inviteToken, { nickname: "승주", pin: "4827" });

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ code: "LINK_EXPIRED" });
    const link = await lookUp(createTestClient(), inviteToken);
    expect(link.status).toBe(410);
  });
});
