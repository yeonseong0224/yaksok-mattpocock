import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api/responses";

/**
 * 상태를 바꾸는 요청의 CSRF 방어(API_CONVENTIONS 7장): Origin 헤더가 이 서비스여야 한다.
 * 브라우저는 POST·PUT·DELETE fetch에 Origin을 붙인다. 없거나 다른 사이트면 403.
 * 통과하면 null, 거부하면 보낼 응답을 돌려준다.
 */
export function rejectForeignOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && sameHost(origin, request.nextUrl.host)) return null;
  return apiError(403, "FORBIDDEN", "허용되지 않은 출처의 요청입니다.");
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
