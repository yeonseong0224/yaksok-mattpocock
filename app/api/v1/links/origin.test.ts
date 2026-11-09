import { describe, expect, it } from "vitest";
import { POST as issueLink } from "./route";
import { POST as registerHost } from "./[inviteToken]/host/route";
import { createTestClient } from "@/test/http";

// 상태를 바꾸는 요청은 Origin 헤더가 이 서비스일 때만 받는다(API_CONVENTIONS 7장 CSRF).

async function issue() {
  const res = await createTestClient().request(issueLink, {
    method: "POST",
    path: "/api/v1/links",
  });
  return (res.body as { inviteToken: string }).inviteToken;
}

describe("다른 사이트에서 온 요청 거부", () => {
  it.each([
    ["다른 사이트의 Origin", { origin: "https://evil.example" }],
    ["Origin 없음", { origin: "" }],
  ])("링크 발급: %s이면 403 FORBIDDEN", async (_name, headers) => {
    const res = await createTestClient().request(issueLink, {
      method: "POST",
      path: "/api/v1/links",
      headers,
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "FORBIDDEN" });
  });

  it("방장 등록: 다른 사이트의 Origin이면 403이고 방장이 생기지 않는다", async () => {
    const inviteToken = await issue();
    const client = createTestClient();

    const res = await client.request(registerHost, {
      method: "POST",
      path: `/api/v1/links/${inviteToken}/host`,
      params: { inviteToken },
      body: { nickname: "승주", pin: "4827" },
      headers: { origin: "https://evil.example" },
    });

    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
    const retry = await client.request(registerHost, {
      method: "POST",
      path: `/api/v1/links/${inviteToken}/host`,
      params: { inviteToken },
      body: { nickname: "승주", pin: "4827" },
    });
    expect(retry.status).toBe(201);
  });
});
