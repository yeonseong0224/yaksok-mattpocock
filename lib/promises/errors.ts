import { apiError } from "@/lib/api/responses";

// 약속을 경로로 받는 API(STATE·MEMBER-API-03 이하)가 함께 쓰는 오류 응답
export const promiseNotFound = () => apiError(404, "PROMISE_NOT_FOUND", "약속을 찾을 수 없습니다.");
export const promiseCancelled = () => apiError(409, "PROMISE_CANCELLED", "취소된 약속입니다.");
export const unauthenticated = () => apiError(401, "UNAUTHENTICATED", "다시 로그인해 주세요.");
export const forbidden = () => apiError(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
export const draftExpired = () =>
  apiError(410, "DRAFT_EXPIRED", "설정 시간 10분이 지나 약속 초안이 만료됐어요.");
export const invalidPromiseState = (
  promiseStatus: string,
  allowedStates: string[],
  message = "현재 약속 상태에서는 요청할 수 없습니다.",
) => apiError(409, "INVALID_PROMISE_STATE", message, { promiseStatus, allowedStates });
export const promiseNotOpen = () =>
  apiError(409, "PROMISE_NOT_OPEN", "방장이 약속을 설정 중입니다.");
export const deadlinePassed = () => apiError(409, "DEADLINE_PASSED", "응답 마감이 지났습니다.");
