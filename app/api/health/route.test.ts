import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { createTestClient } from "@/test/http";

describe("GET /api/health", () => {
  it("새 스키마로 DB에 연결되면 ok를 돌려준다", async () => {
    const client = createTestClient();

    const res = await client.request(GET, { path: "/api/health" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
