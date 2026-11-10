import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/prisma/generated/client";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { apiError, readJsonObject } from "@/lib/api/responses";
import { linkExpired, linkNotFound } from "@/lib/links/errors";
import { lockLink } from "@/lib/links/link-state";
import { deleteDraft, DRAFT_TTL_MINUTES } from "@/lib/promises/promise-state";
import { parseCredentials } from "@/lib/members/credentials";
import { hashPin } from "@/lib/members/pin";
import {
  draftSessionExpiresAt,
  issueSession,
  setSessionCookie,
  type SessionCookie,
} from "@/lib/members/session";
import { addMinutes, toKstIso } from "@/lib/time";

type Outcome =
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "taken" }
  | {
      kind: "created";
      participantId: string;
      draftExpiresAt: Date;
      session: SessionCookie;
    };

// MEMBER-API-02 방장 등록(약속 생성). 링크를 먼저 선점한 사람이 방장이 된다.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ inviteToken: string }> },
) {
  const forbidden = rejectForeignOrigin(request);
  if (forbidden) return forbidden;

  const { inviteToken } = await context.params;
  const parsed = parseCredentials(await readJsonObject(request));
  if (!parsed.ok) return parsed.response;
  const { nickname, pin } = parsed.credentials;
  // 해시는 잠금을 잡기 전에 계산해 잠금 유지 시간을 줄인다.
  const passwordHash = await hashPin(pin);

  let outcome: Outcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
      const link = await lockLink(tx, inviteToken);
      if (!link) return { kind: "not_found" };
      if (link.expired) return { kind: "expired" };
      if (link.promiseId) {
        // 10분 안에 설정을 마치지 못한 draft는 지우고 이 사람을 새 방장으로 받는다(STATE-02-02).
        if (!link.draftExpired) return { kind: "taken" };
        await deleteDraft(tx, link.promiseId);
      }

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
        session: await issueSession(tx, host, link.now, draftSessionExpiresAt(link.now)),
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
