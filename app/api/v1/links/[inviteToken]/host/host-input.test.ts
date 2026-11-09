import { describe, expect, it } from "vitest";
import { POST as issueLink } from "../../route";
import { POST as registerHost } from "./route";
import { createTestClient } from "@/test/http";

// 닉네임·PIN 규칙(MEMBER-05-01~04, MEMBER-06-01). 방장 등록과 참여자 등록이 같은 규칙을 쓴다.

async function registerOnNewLink(body: unknown) {
  const client = createTestClient();
  const issued = await client.request(issueLink, { method: "POST", path: "/api/v1/links" });
  const { inviteToken } = issued.body as { inviteToken: string };
  return client.request(registerHost, {
    method: "POST",
    path: `/api/v1/links/${inviteToken}/host`,
    params: { inviteToken },
    body,
  });
}

describe("닉네임 규칙", () => {
  it.each([
    ["앞뒤 공백은 지운다", "  승주  ", "승주"],
    ["가운데 공백은 그대로 둔다", "철  수", "철  수"],
    ["대소문자는 그대로 둔다", "Chulsoo", "Chulsoo"],
    ["이모지와 기호를 쓸 수 있다", "철수🔥!", "철수🔥!"],
    ["화면에 보이는 글자 10자까지 쓸 수 있다", "가나다라마바사아자차", "가나다라마바사아자차"],
    ["ZWJ로 이은 이모지는 한 글자로 센다", "👨‍👩‍👧".repeat(10), "👨‍👩‍👧".repeat(10)],
    ["이모지 변형 선택자를 쓸 수 있다", "❤️", "❤️"],
    ["1자도 된다", "a", "a"],
    ["NFC로 정규화한다", "é", "é"],
  ])("%s", async (_name, input, saved) => {
    const res = await registerOnNewLink({ nickname: input, pin: "4827" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nickname: saved });
  });

  it.each([
    ["비어 있으면", ""],
    ["공백뿐이면", "   "],
    ["화면에 보이는 글자가 11자면", "가나다라마바사아자차카"],
    ["폭 0 공백(서식 문자)이 섞이면", "철수​"],
    ["방향 표시 문자(서식 문자)가 섞이면", "철수‮"],
    ["제어 문자가 섞이면", "철\u0007수"],
    ["가운데 줄바꿈(제어 문자)이 섞이면", "철\n수"],
  ])("%s 422 VALIDATION_FAILED", async (_name, input) => {
    const res = await registerOnNewLink({ nickname: input, pin: "4827" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", details: { field: "nickname" } });
  });
});

describe("PIN 규칙", () => {
  it.each([["48ab"], ["48271"], ["482"], [""], ["４８２７"]])(
    "숫자 4자리가 아닌 %j는 422 VALIDATION_FAILED",
    async (pin) => {
      const res = await registerOnNewLink({ nickname: "승주", pin });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", details: { field: "pin" } });
    },
  );
});

describe("요청 형식", () => {
  it.each([
    ["닉네임이 없으면", { pin: "4827" }],
    ["PIN이 숫자 타입이면", { nickname: "승주", pin: 4827 }],
    ["본문이 배열이면", ["승주", "4827"]],
  ])("%s 400 INVALID_REQUEST", async (_name, body) => {
    const res = await registerOnNewLink(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
