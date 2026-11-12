import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { invalidRequest, noStore } from "@/lib/api/responses";
import { authenticate, setSessionCookie } from "@/lib/members/session";
import { promiseCancelled, promiseNotFound, unauthenticated } from "@/lib/promises/errors";
import { effectiveStatus, findPromise, isUuid } from "@/lib/promises/promise-state";
import { toKstIso } from "@/lib/time";

// MEMBER-API-05 내 참여 정보. 세션으로 내가 누구인지, 방장인지, 지금 무엇을 할 수 있는지 알려준다.
// permissions는 화면 표시용 힌트다. 권한 판정은 각 쓰기 API가 다시 한다.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  const promise = await findPromise(prisma, promiseId);
  if (!promise) return promiseNotFound();
  // 취소된 약속은 인증보다 먼저 409다(C-10: 모든 약속 경로 API 통일, 약속 관리 티켓 05).
  if (promise.status === "cancelled") return promiseCancelled();
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) return unauthenticated();

  const me = await prisma.participant.findUniqueOrThrow({ where: { id: viewer.participantId } });
  const promiseStatus = effectiveStatus(promise);
  const deadlinePassed =
    promise.votingDeadlineAt !== null && promise.votingDeadlineAt <= promise.now;
  const active = me.status === "active";
  const canEditAvailability = active && promiseStatus === "collecting";

  const response = NextResponse.json({
    participantId: me.id,
    nickname: me.nickname,
    role: me.role,
    status: me.status,
    availabilitySubmittedAt: me.availabilitySubmittedAt
      ? toKstIso(me.availabilitySubmittedAt)
      : null,
    promiseStatus,
    deadlinePassed,
    permissions: {
      canEditAvailability,
      canSubmit: canEditAvailability,
      canManagePromise: active && me.role === "host" && promiseStatus !== "cancelled",
      canLeave: active && promiseStatus !== "cancelled",
    },
    sessionExpiresAt: toKstIso(viewer.expiresAt),
  });
  setSessionCookie(response, viewer.cookie);
  return noStore(response);
}
