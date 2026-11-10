import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/prisma/generated/client";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { invalidRequest, noStore, readJsonObject } from "@/lib/api/responses";
import { parseCredentials } from "@/lib/members/credentials";
import { nicknameTaken, promiseFull } from "@/lib/members/errors";
import { hashPin } from "@/lib/members/pin";
import {
  authenticate,
  issueSession,
  afterDeadlineExpiresAt,
  setSessionCookie,
  type SessionCookie,
} from "@/lib/members/session";
import {
  deadlinePassed,
  forbidden,
  invalidPromiseState,
  promiseCancelled,
  promiseNotFound,
  promiseNotOpen,
  unauthenticated,
} from "@/lib/promises/errors";
import { effectiveStatus, findPromise, isUuid, lockPromise } from "@/lib/promises/promise-state";

type Outcome =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "not_open" }
  | { kind: "deadline_passed" }
  | { kind: "wrong_state"; status: string }
  | { kind: "full" }
  | { kind: "taken" }
  | {
      kind: "registered";
      participantId: string;
      count: number;
      limit: number;
      cookie: SessionCookie;
    };

// MEMBER-API-03 참여자 등록. 모집 중이고 마감 전인 약속에만 멤버로 등록하고 바로 로그인시킨다.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  const parsed = parseCredentials(await readJsonObject(request));
  if (!parsed.ok) return parsed.response;
  const { nickname, pin } = parsed.credentials;
  // 해시는 잠금을 잡기 전에 계산해 잠금 유지 시간을 줄인다.
  const passwordHash = await hashPin(pin);

  let outcome: Outcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
      // 상태·마감·정원은 약속 행을 잠근 뒤 DB 시각으로 다시 읽어 판정한다(ERD 8.2).
      const promise = await lockPromise(tx, promiseId);
      if (!promise) return { kind: "not_found" };
      if (promise.status === "cancelled") return { kind: "cancelled" };
      if (promise.status === "draft") return { kind: "not_open" };
      if (effectiveStatus(promise) === "closed" && promise.status === "collecting") {
        // 마감 뒤 처음 들어온 쓰기 요청이 DB 상태를 closed로 바꾼다(ADR-0001).
        await tx.promise.update({ where: { id: promiseId }, data: { status: "closed" } });
        return { kind: "deadline_passed" };
      }
      if (promise.status !== "collecting") return { kind: "wrong_state", status: promise.status };

      const count = await tx.participant.count({ where: { promiseId, status: "active" } });
      const limit = promise.participantLimit!;
      if (count >= limit) return { kind: "full" };
      // 탈퇴한 사람의 닉네임도 다시 쓸 수 없다(MEMBER-05-06). 그래서 상태를 가리지 않고 찾는다.
      const taken = await tx.participant.findUnique({
        where: { promiseId_normalizedNickname: { promiseId, normalizedNickname: nickname } },
      });
      if (taken) return { kind: "taken" };

      const member = await tx.participant.create({
        data: { promiseId, nickname, normalizedNickname: nickname, passwordHash, role: "member" },
      });
      const cookie = await issueSession(
        tx,
        member,
        promise.now,
        afterDeadlineExpiresAt(promise.votingDeadlineAt!),
      );
      return { kind: "registered", participantId: member.id, count: count + 1, limit, cookie };
    });
  } catch (error) {
    // 잠금을 지나 들어온 같은 닉네임은 UNIQUE(promise_id, normalized_nickname)가 막는다.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      outcome = { kind: "taken" };
    } else {
      throw error;
    }
  }

  switch (outcome.kind) {
    case "not_found":
      return promiseNotFound();
    case "cancelled":
      return promiseCancelled();
    case "not_open":
      return promiseNotOpen();
    case "deadline_passed":
      return deadlinePassed();
    case "wrong_state":
      return invalidPromiseState(outcome.status, ["collecting"]);
    case "full":
      return promiseFull();
    case "taken":
      return nicknameTaken();
    case "registered": {
      const response = NextResponse.json(
        {
          participantId: outcome.participantId,
          nickname,
          role: "member",
          status: "active",
          availabilitySubmittedAt: null,
          currentParticipantCount: outcome.count,
          participantLimit: outcome.limit,
        },
        { status: 201 },
      );
      setSessionCookie(response, outcome.cookie);
      return noStore(response);
    }
  }
}

// MEMBER-API-06 참여자 명단. 등록한 참여자만 본다. active 참여자를 등록순으로, 제출 여부 없이 돌려준다.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  const promise = await findPromise(prisma, promiseId);
  if (!promise) return promiseNotFound();
  if (promise.status === "cancelled") return promiseCancelled();
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) return unauthenticated();
  // 설정 중에는 방장 말고는 명단·정원을 보여주지 않는다(MEMBER-03-01).
  if (promise.status === "draft" && viewer.role !== "host") return forbidden();

  const participants = await prisma.participant.findMany({
    where: { promiseId, status: "active" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, nickname: true, role: true },
  });
  const response = NextResponse.json({
    participantLimit: promise.participantLimit,
    currentParticipantCount: participants.length,
    participants: participants.map((p) => ({
      participantId: p.id,
      nickname: p.nickname,
      role: p.role,
      isMe: p.id === viewer.participantId,
    })),
  });
  setSessionCookie(response, viewer.cookie);
  return noStore(response);
}
