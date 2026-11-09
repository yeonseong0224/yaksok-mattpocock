import { NextResponse, type NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createTestClient } from "./http";

// 약속별 세션 쿠키(ys_session_{promiseId}, Path=약속 API 경로)를 흉내 내는 핸들러
async function login(_req: NextRequest, ctx: { params: Promise<{ promiseId: string }> }) {
  const { promiseId } = await ctx.params;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(`ys_session_${promiseId}`, `token-${promiseId}`, {
    httpOnly: true,
    path: `/api/v1/promises/${promiseId}`,
  });
  return res;
}

async function logout(_req: NextRequest, ctx: { params: Promise<{ promiseId: string }> }) {
  const { promiseId } = await ctx.params;
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(`ys_session_${promiseId}`, "", {
    path: `/api/v1/promises/${promiseId}`,
    maxAge: 0,
  });
  return res;
}

function echoCookies(req: NextRequest) {
  return NextResponse.json({
    cookies: Object.fromEntries(req.cookies.getAll().map((c) => [c.name, c.value])),
  });
}

function loginTo(client: ReturnType<typeof createTestClient>, promiseId: string) {
  return client.request(login, {
    method: "POST",
    path: `/api/v1/promises/${promiseId}/auth/session`,
    params: { promiseId },
  });
}

describe("테스트 클라이언트의 쿠키", () => {
  it("받은 쿠키를 같은 약속 경로의 다음 요청에 보낸다", async () => {
    const client = createTestClient();
    await loginTo(client, "p1");

    const res = await client.request(echoCookies, { path: "/api/v1/promises/p1/me" });

    expect(res.body).toEqual({ cookies: { ys_session_p1: "token-p1" } });
  });

  it("다른 약속 경로에는 보내지 않는다", async () => {
    const client = createTestClient();
    await loginTo(client, "p1");

    const res = await client.request(echoCookies, { path: "/api/v1/promises/p10/me" });

    expect(res.body).toEqual({ cookies: {} });
  });

  it("만료된 쿠키는 지운다", async () => {
    const client = createTestClient();
    await loginTo(client, "p1");
    await client.request(logout, {
      method: "DELETE",
      path: "/api/v1/promises/p1/auth/session",
      params: { promiseId: "p1" },
    });

    expect(client.cookie("ys_session_p1", "/api/v1/promises/p1/me")).toBeUndefined();
  });

  it("클라이언트끼리는 쿠키를 공유하지 않는다(기기 두 대)", async () => {
    const phone = createTestClient();
    const laptop = createTestClient();
    await loginTo(phone, "p1");

    expect(phone.cookie("ys_session_p1", "/api/v1/promises/p1/me")).toBe("token-p1");
    expect(laptop.cookie("ys_session_p1", "/api/v1/promises/p1/me")).toBeUndefined();
  });
});
