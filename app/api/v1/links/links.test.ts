import { describe, expect, it } from "vitest";
import { POST as issueLink } from "./route";
import { GET as lookUpLink } from "./[inviteToken]/route";
import { createTestClient, type TestClient } from "@/test/http";
import { ageLink } from "@/test/db";

async function issue(client: TestClient): Promise<string> {
  const res = await client.request(issueLink, { method: "POST", path: "/api/v1/links" });
  expect(res.status).toBe(201);
  return (res.body as { inviteToken: string }).inviteToken;
}

function lookUp(client: TestClient, inviteToken: string) {
  return client.request(lookUpLink, {
    path: `/api/v1/links/${inviteToken}`,
    params: { inviteToken },
  });
}

describe("초대 링크 발급과 조회", () => {
  it("발급한 링크는 아직 아무도 방장 등록을 하지 않은 상태다", async () => {
    const client = createTestClient();
    const inviteToken = await issue(client);

    const res = await lookUp(client, inviteToken);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      inviteToken,
      promiseStatus: "unclaimed",
      promiseId: null,
      nextAction: "register_host",
      pollAfterMs: null,
    });
  });

  it("링크를 여러 번 조회해도 약속이나 방장이 생기지 않는다", async () => {
    const client = createTestClient();
    const inviteToken = await issue(client);

    await lookUp(client, inviteToken);
    const res = await lookUp(client, inviteToken);

    expect(res.body).toMatchObject({ promiseStatus: "unclaimed", promiseId: null });
  });

  it("링크마다 서로 다른 초대 토큰을 발급한다", async () => {
    const client = createTestClient();

    const first = await issue(client);
    const second = await issue(client);

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(20);
  });

  it("없는 링크는 404 LINK_NOT_FOUND", async () => {
    const res = await lookUp(createTestClient(), "no-such-token");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "LINK_NOT_FOUND" });
  });

  it("발급 후 3개월이 지난 링크는 410 LINK_EXPIRED", async () => {
    const client = createTestClient();
    const inviteToken = await issue(client);
    await ageLink(inviteToken, "3 months 1 minute");

    const res = await lookUp(client, inviteToken);

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ code: "LINK_EXPIRED" });
  });

  it("3개월이 되기 직전의 링크는 아직 쓸 수 있다", async () => {
    const client = createTestClient();
    const inviteToken = await issue(client);
    await ageLink(inviteToken, "3 months -1 minute");

    const res = await lookUp(client, inviteToken);

    expect(res.status).toBe(200);
  });
});
