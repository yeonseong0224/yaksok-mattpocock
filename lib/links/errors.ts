import { apiError } from "@/lib/api/responses";

// 링크를 경로로 받는 API(MEMBER-API-01, 02)가 함께 쓰는 오류 응답
export const linkNotFound = () => apiError(404, "LINK_NOT_FOUND", "유효하지 않은 링크입니다.");
export const linkExpired = () => apiError(410, "LINK_EXPIRED", "만료된 링크입니다.");
