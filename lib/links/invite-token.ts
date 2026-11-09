import { randomBytes } from "node:crypto";

// 초대 URL 토큰. 인증 없이 조회되므로 추측할 수 없는 암호학적 난수를 쓴다(MEMBER-API-01 보안 정보).
export function generateInviteToken(): string {
  return randomBytes(16).toString("base64url");
}
