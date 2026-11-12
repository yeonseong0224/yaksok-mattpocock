import { apiError } from "@/lib/api/responses";

// 참여자 등록·로그인 API(MEMBER-API-03·04)가 쓰는 오류 응답
export const nicknameTaken = () =>
  apiError(
    409,
    "NICKNAME_TAKEN",
    "이미 사용 중인 닉네임입니다. 본인이 등록했다면 로그인해 주세요.",
    {
      field: "nickname",
    },
  );
export const promiseFull = () => apiError(409, "PROMISE_FULL", "참여 정원이 모두 찼습니다.");
/** 탈퇴했거나 내보내진 참여자의 재로그인(2026-11-11 결정, C-07: 403 PARTICIPANT_CANCELLED를 바꿈) */
export const departedParticipantLogin = () =>
  apiError(401, "UNAUTHENTICATED", "이 약속에서 나갔거나 내보내졌어요.");
