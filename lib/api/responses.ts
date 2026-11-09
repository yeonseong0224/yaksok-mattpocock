import { NextResponse } from "next/server";

// 실패 응답 형식: { code, message, details? } (API_CONVENTIONS 3장)
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return noStore(
    NextResponse.json(details ? { code, message, details } : { code, message }, { status }),
  );
}

/** 세션·약속 정보가 담긴 응답은 캐시하지 않는다(STATE-API-00 보안 정보). */
export function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** JSON 객체 본문을 읽는다. 파싱에 실패하거나 객체가 아니면 null. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const invalidRequest = () =>
  apiError(400, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다.");
