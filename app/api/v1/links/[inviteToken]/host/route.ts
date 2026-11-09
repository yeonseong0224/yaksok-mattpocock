import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/prisma/generated/client";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { apiError, invalidRequest, readJsonObject } from "@/lib/api/responses";
import { linkExpired, linkNotFound } from "@/lib/links/errors";
import { lockLink } from "@/lib/links/link-state";
import { normalizeNickname } from "@/lib/members/nickname";
import { hashPin } from "@/lib/members/pin";
import { isValidPin } from "@/lib/members/pin-format";
import {
  DRAFT_SESSION_SECONDS,
  issueSession,
  setSessionCookie,
  type IssuedSession,
} from "@/lib/members/session";
import { addMinutes, toKstIso } from "@/lib/time";

/** draft는 생성 후 이 시간 안에 설정을 마쳐야 한다(STATE-02-02) */
const DRAFT_TTL_MINUTES = 10;

type Outcome =
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "taken" }
  | {
      kind: "created";
      participantId: string;
      draftExpiresAt: Date;
      session: IssuedSession;
    };

// MEMBER-API-02 방장 등록(약속 생성). 링크를 먼저 선점한 사람이 방장이 된다.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ inviteToken: string }> },
) {
  const forbidden = rejectForeignOrigin(request);
  if (forbidden) return forbidden;

  const { inviteToken } = await context.params;
  const body = await readJsonObject(request);
  if (!body || typeof body.nickname !== "string" || typeof body.pin !== "string") {
    return invalidRequest();
  }
  const normalized = normalizeNickname(body.nickname);
  if (!normalized.ok) {
    return apiError(422, "VALIDATION_FAILED", normalized.message, { field: "nickname" });
  }
  const { nickname } = normalized;
  if (!isValidPin(body.pin)) {
    return apiError(422, "VALIDATION_FAILED", "PIN은 숫자 4자리여야 합니다.", { field: "pin" });
  }
  // 해시는 잠금을 잡기 전에 계산해 잠금 유지 시간을 줄인다.
  const passwordHash = await hashPin(body.pin);

  let outcome: Outcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
      const link = await lockLink(tx, inviteToken);
      if (!link) return { kind: "not_found" };
      if (link.expired) return { kind: "expired" };
      // 만료된 draft를 정리하고 새 방장을 받는 처리는 티켓 03(STATE-02-02)에서 여기에 들어온다.
      if (link.promiseId) return { kind: "taken" };

      const promise = await tx.promise.create({
        data: { promiseLinkId: link.linkId, status: "draft" },
      });
      const host = await tx.participant.create({
        data: {
          promiseId: promise.id,
          nickname,
          normalizedNickname: nickname,
          passwordHash,
          role: "host",
        },
      });
      return {
        kind: "created",
        participantId: host.id,
        draftExpiresAt: addMinutes(promise.createdAt, DRAFT_TTL_MINUTES),
        session: await issueSession(tx, host, link.now, DRAFT_SESSION_SECONDS),
      };
    });
  } catch (error) {
    // 잠금을 지나 들어온 동시 등록은 promise_link_id UNIQUE가 2차로 막는다(ERD 8.1).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      outcome = { kind: "taken" };
    } else {
      throw error;
    }
  }

  if (outcome.kind === "not_found") return linkNotFound();
  if (outcome.kind === "expired") return linkExpired();
  if (outcome.kind === "taken") {
    return apiError(
      409,
      "HOST_ALREADY_REGISTERED",
      "이미 다른 분이 약속을 만들었습니다. 본인이 등록했다면 로그인해 주세요.",
    );
  }

  const response = NextResponse.json(
    {
      promiseId: outcome.session.promiseId,
      participantId: outcome.participantId,
      nickname,
      role: "host",
      promiseStatus: "draft",
      draftExpiresAt: toKstIso(outcome.draftExpiresAt),
    },
    { status: 201 },
  );
  setSessionCookie(response, outcome.session);
  return response;
}
