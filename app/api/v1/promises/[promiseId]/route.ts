import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { invalidRequest, noStore } from "@/lib/api/responses";
import { scheduledTimeJson, loadConfirmation } from "@/lib/candidates/load-candidates";
import { authenticate, setSessionCookie } from "@/lib/members/session";
import { promiseCancelled, promiseNotFound } from "@/lib/promises/errors";
import {
  draftExpiresAt,
  effectiveStatus,
  findPromise,
  isDraftExpired,
  isUuid,
  settingsJson,
} from "@/lib/promises/promise-state";
import { toKstIso } from "@/lib/time";

// STATE-API-01 약속 상태·설정 조회. GET은 DB를 바꾸지 않는다(마감·초안 만료는 계산만 한다).
// 로그인하지 않은 사람은 상태만, 이 약속의 active 참여자는 설정까지 본다.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();

  const promise = await findPromise(prisma, promiseId);
  if (!promise) return promiseNotFound();
  if (promise.status === "cancelled") return promiseCancelled();

  const promiseStatus = effectiveStatus(promise);
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) {
    return noStore(NextResponse.json({ promiseId, promiseStatus }));
  }

  const isDraft = promise.status === "draft";
  // 확정 일정: 끝 시각은 계산하고, 참석 가능한 사람은 현재 제출값으로 다시 계산한다(RESULT-13-01·13-02).
  // 참석 가능 인원이 2명 미만이 돼도 확정은 그대로 두고, 방장에게만 알린다(hostActionRequired).
  const confirmation =
    promise.status === "confirmed" ? await loadConfirmation(prisma, promise) : null;
  const response = NextResponse.json({
    promiseId,
    promiseStatus,
    draftExpiresAt: isDraft ? toKstIso(draftExpiresAt(promise)) : null,
    draftExpired: isDraftExpired(promise),
    settings: settingsJson(promise),
    currentConfirmation: confirmation && {
      ...scheduledTimeJson(confirmation),
      hostActionRequired: viewer.role === "host" && confirmation.participants.length < 2,
    },
  });
  // 쿠키 만료를 DB 세션 만료에 맞춘다(모집 시작으로 늘어난 만료를 다른 기기에도 반영).
  setSessionCookie(response, viewer.cookie);
  return noStore(response);
}
