import { apiError, invalidRequest } from "@/lib/api/responses";
import { normalizeNickname } from "@/lib/members/nickname";
import { isValidPin } from "@/lib/members/pin-format";

// 방장 등록·참여자 등록이 함께 쓰는 닉네임·PIN 입력 검사(MEMBER-05-01~04, MEMBER-06-01)

/** 닉네임·PIN. 화면 폼과 서버가 같은 모양을 쓴다. */
export type Credentials = { nickname: string; pin: string };

/**
 * 요청 본문에서 닉네임·PIN을 꺼내 규칙대로 검사한다.
 * 성공하면 정규화한 닉네임과 PIN을, 실패하면 보낼 응답(400·422)을 돌려준다.
 */
export function parseCredentials(
  body: Record<string, unknown> | null,
): { ok: true; credentials: Credentials } | { ok: false; response: Response } {
  if (!body || typeof body.nickname !== "string" || typeof body.pin !== "string") {
    return { ok: false, response: invalidRequest() };
  }
  const normalized = normalizeNickname(body.nickname);
  if (!normalized.ok) {
    return {
      ok: false,
      response: apiError(422, "VALIDATION_FAILED", normalized.message, { field: "nickname" }),
    };
  }
  if (!isValidPin(body.pin)) {
    return {
      ok: false,
      response: apiError(422, "VALIDATION_FAILED", "PIN은 숫자 4자리여야 합니다.", {
        field: "pin",
      }),
    };
  }
  return { ok: true, credentials: { nickname: normalized.nickname, pin: body.pin } };
}
