import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/prisma/generated/client";
import { apiError, invalidRequest, noStore } from "@/lib/api/responses";
import { authenticate, setSessionCookie } from "@/lib/members/session";
import { promiseCancelled, promiseNotFound, unauthenticated } from "@/lib/promises/errors";
import { effectiveStatus, findPromise, isUuid } from "@/lib/promises/promise-state";
import { minuteToHhmm, toKstIso } from "@/lib/time";

// TIME-API-02 가능 시간 현황. 입력 화면이 5초마다 조회한다. DB는 바꾸지 않는다.
// 다른 참여자의 제출 여부는 알려주지 않는다: 미제출과 빈 선택 제출 모두 availableSlots가 []다(TIME-12-02).
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();

  const viewer = await authenticate(prisma, request, promiseId);

  // 약속·참여자·슬롯을 한 시점 기준으로 읽는다.
  const snapshot = await prisma.$transaction(
    async (tx) => {
      const promise = await findPromise(tx, promiseId);
      if (!promise) return null;
      const people = await tx.participant.findMany({
        where: { promiseId, status: "active" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          nickname: true,
          role: true,
          availabilitySubmittedAt: true,
          availabilityVersion: true,
          availableSlots: { select: { slotStartAt: true }, orderBy: { slotStartAt: "asc" } },
        },
      });
      return { promise, people };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  if (!snapshot) return promiseNotFound();
  const { promise, people } = snapshot;
  if (promise.status === "cancelled") return promiseCancelled();
  if (!viewer) return unauthenticated();
  if (promise.status === "draft") {
    return apiError(409, "PROMISE_NOT_COLLECTING", "방장이 약속을 설정 중입니다.");
  }
  const me = people.find((p) => p.id === viewer.participantId);
  if (!me) return unauthenticated();

  const slotsOf = (p: (typeof people)[number]) =>
    p.availableSlots.map((s) => toKstIso(s.slotStartAt));

  const response = NextResponse.json({
    status: effectiveStatus(promise),
    serverTime: toKstIso(promise.now),
    settings: {
      // 변경 알림 배너가 한 응답 안의 값끼리 비교하도록 이름·정원도 함께 준다(약속 관리 티켓 08).
      title: promise.title,
      participantLimit: promise.participantLimit,
      dateRangeStart: promise.dateRangeStart,
      dateRangeEnd: promise.dateRangeEnd,
      dailyStartTime: minuteToHhmm(promise.dailyStartMinute!),
      dailyEndTime: minuteToHhmm(promise.dailyEndMinute!),
      durationMinutes: promise.durationMinutes,
      votingDeadlineAt: toKstIso(promise.votingDeadlineAt!),
    },
    totalParticipants: people.length,
    participants: people.map((p) => ({
      participantId: p.id,
      nickname: p.nickname,
      isHost: p.role === "host",
      // 슬롯은 제출해야만 저장된다. 범위 확대로 제출 상태가 풀려도 남은 선택은 보인다(X-07).
      availableSlots: slotsOf(p),
    })),
    me: {
      participantId: me.id,
      version: me.availabilityVersion,
      submitted: me.availabilitySubmittedAt !== null,
      slots: slotsOf(me),
    },
  });
  setSessionCookie(response, viewer.cookie);
  return noStore(response);
}
