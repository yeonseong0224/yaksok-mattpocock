import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/prisma/generated/client";
import { invalidRequest, noStore } from "@/lib/api/responses";
import { loadCandidates } from "@/lib/candidates/load-candidates";
import { authenticate, setSessionCookie } from "@/lib/members/session";
import {
  invalidPromiseState,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/promises/errors";
import { effectiveStatus, findPromise, isUuid } from "@/lib/promises/promise-state";
import { toKstIso } from "@/lib/time";

// 후보 조회(STATE-API-10). 저장하지 않고 조회할 때마다 후보 계산 모듈로 계산한다.
// 첫 슬라이스 결정(spec.md, RESULT-09-01·10-01): 모집 중에도 현재 제출값 기준의 후보를 보여주고,
// 후보마다 참석 가능한 사람의 닉네임을 로그인한 참여자 모두에게 공개한다. 서로 겹치지 않는 최대 5개라 페이지는 없다.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();

  const existing = await findPromise(prisma, promiseId);
  if (!existing) return promiseNotFound();
  if (existing.status === "cancelled") return promiseCancelled();
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) return unauthenticated();
  if (existing.status === "draft") {
    return invalidPromiseState("draft", ["collecting", "closed", "confirmed"]);
  }

  // 약속 설정·참여자·슬롯과 기준 시각을 한 시점으로 읽는다.
  const result = await prisma.$transaction(
    async (tx) => {
      const promise = await findPromise(tx, promiseId);
      if (!promise) return null;
      return { promise, candidates: await loadCandidates(tx, promise) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  if (!result) return promiseNotFound();
  const { promise, candidates } = result;

  const response = NextResponse.json({
    promiseId,
    promiseStatus: effectiveStatus(promise),
    calculatedAt: toKstIso(promise.now),
    candidates: candidates.map((c) => ({
      startAt: toKstIso(c.startAt),
      endAt: toKstIso(c.endAt),
      availableParticipantCount: c.participants.length,
      participants: c.participants,
    })),
  });
  setSessionCookie(response, viewer.cookie);
  return noStore(response);
}
