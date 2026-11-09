import { countGraphemes } from "@/lib/text";

// 닉네임 정규화(MEMBER-05-01~04). 방장 등록·참여자 등록·로그인이 모두 이 규칙을 쓴다.

export const NICKNAME_MAX_LENGTH = 10;

/** 제어 문자(Cc)와 보이지 않는 서식 문자(Cf). 이모지 조합에 쓰는 ZWJ(U+200D)는 허용한다. */
const FORBIDDEN_CHARACTER = /\p{Cc}|(?!\u200D)\p{Cf}/u;

export type NicknameResult = { ok: true; nickname: string } | { ok: false; message: string };

/**
 * 앞뒤 공백을 지우고 NFC로 정규화한다. 대소문자와 가운데 공백은 그대로 둔다.
 * 결과는 표시용 `nickname`과 중복 검사용 `normalized_nickname`에 똑같이 저장한다.
 */
export function normalizeNickname(input: string): NicknameResult {
  const nickname = input.trim().normalize("NFC");
  if (FORBIDDEN_CHARACTER.test(nickname)) {
    return { ok: false, message: "닉네임에 쓸 수 없는 보이지 않는 문자가 들어 있어요." };
  }
  const length = countGraphemes(nickname);
  if (length < 1 || length > NICKNAME_MAX_LENGTH) {
    return {
      ok: false,
      message: `닉네임은 1자 이상 ${NICKNAME_MAX_LENGTH}자 이하로 입력해 주세요.`,
    };
  }
  return { ok: true, nickname };
}
