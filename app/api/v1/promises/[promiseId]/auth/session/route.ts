import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { apiError, invalidRequest, noStore, readJsonObject } from "@/lib/api/responses";
import { departedParticipantLogin } from "@/lib/members/errors";
import { normalizeNickname } from "@/lib/members/nickname";
import { verifyAgainstDummy, verifyPin } from "@/lib/members/pin";
import { isValidPin } from "@/lib/members/pin-format";
import {
  clearSessionCookie,
  hasSessionCookie,
  issueSession,
  revokeSession,
  loginSessionExpiresAt,
  setSessionCookie,
} from "@/lib/members/session";
import { promiseCancelled, promiseNotFound, unauthenticated } from "@/lib/promises/errors";
import { effectiveStatus, findPromise, isUuid } from "@/lib/promises/promise-state";
import { toKstIso } from "@/lib/time";

// 닉네임이 없는 경우와 PIN이 틀린 경우를 구분하지 않는다(ERD 9). 실패 응답은 이 한 곳에서만 만든다.
// MVP에서는 시도 횟수 제한이 없다(member.md MEMBER-API-04 보안 정보). 넣는다면 이 경로에 붙인다.
const invalidCredentials = () =>
  apiError(401, "INVALID_CREDENTIALS", "닉네임 또는 PIN이 올바르지 않습니다.");

// MEMBER-API-04 재인증(로그인). 다른 기기에서 닉네임·PIN으로 같은 참여자의 새 세션을 받는다.
// 마감된 약속도 결과를 봐야 하므로 로그인은 막지 않는다. 취소된 약속만 거부한다.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  const body = await readJsonObject(request);
  if (!body || typeof body.nickname !== "string" || typeof body.pin !== "string") {
    return invalidRequest();
  }
  if (!isValidPin(body.pin)) {
    return apiError(422, "VALIDATION_FAILED", "PIN은 숫자 4자리여야 합니다.", { field: "pin" });
  }

  const promise = await findPromise(prisma, promiseId);
  if (!promise) return promiseNotFound();
  if (promise.status === "cancelled") return promiseCancelled();

  // 등록과 같은 규칙으로 닉네임을 정규화해서 찾는다. 규칙에 안 맞는 닉네임은 있을 수 없으니 실패로 본다.
  const normalized = normalizeNickname(body.nickname);
  const participant = normalized.ok
    ? await prisma.participant.findUnique({
        where: {
          promiseId_normalizedNickname: { promiseId, normalizedNickname: normalized.nickname },
        },
      })
    : null;
  const pinMatches = participant
    ? await verifyPin(body.pin, participant.passwordHash)
    : await verifyAgainstDummy(body.pin);
  if (!participant || !pinMatches) return invalidCredentials();
  if (participant.status !== "active") {
    return departedParticipantLogin();
  }

  // 기기마다 새 세션을 만든다. 다른 기기의 세션은 그대로 둔다(MEMBER-04-02).
  const expiresAt = loginSessionExpiresAt(promise);
  const cookie = await issueSession(prisma, participant, promise.now, expiresAt);
  const response = NextResponse.json({
    participantId: participant.id,
    nickname: participant.nickname,
    role: participant.role,
    status: participant.status,
    promiseStatus: effectiveStatus(promise),
    sessionExpiresAt: toKstIso(expiresAt),
  });
  setSessionCookie(response, cookie);
  return noStore(response);
}

// MEMBER-API-07 로그아웃. 이 기기의 세션만 끝낸다. 참여는 그대로이고 다시 로그인할 수 있다.
// 세션 행은 지우지 않고 만료 시각을 지금으로 바꾼다(티켓 04). 이미 만료된 쿠키여도 204다.
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  if (!(await findPromise(prisma, promiseId))) return promiseNotFound();
  if (!hasSessionCookie(request, promiseId)) return unauthenticated();

  await revokeSession(prisma, request, promiseId);
  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response, promiseId);
  return noStore(response);
}
