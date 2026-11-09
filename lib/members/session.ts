import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";
import type { Prisma } from "@/prisma/generated/client";

/** draft에서 발급한 세션의 유지 시간(MEMBER-06-03) */
export const DRAFT_SESSION_SECONDS = 24 * 60 * 60;

export type IssuedSession = { promiseId: string; token: string; maxAgeSeconds: number };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * 세션을 만든다. DB에는 토큰의 해시와 `now + lifetimeSeconds` 만료 시각만 저장하고,
 * 원본 토큰은 `setSessionCookie`로 같은 수명의 쿠키에 담아 브라우저에만 내려준다.
 */
export async function issueSession(
  tx: Prisma.TransactionClient,
  participant: { id: string; promiseId: string },
  now: Date,
  lifetimeSeconds: number,
): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  await tx.participantSession.create({
    data: {
      participantId: participant.id,
      sessionTokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + lifetimeSeconds * 1000),
    },
  });
  return { promiseId: participant.promiseId, token, maxAgeSeconds: lifetimeSeconds };
}

/** 약속별 httpOnly 세션 쿠키(API_CONVENTIONS 5장). Path를 그 약속의 API 경로로 좁힌다. */
export function setSessionCookie(response: NextResponse, session: IssuedSession) {
  response.cookies.set(`ys_session_${session.promiseId}`, session.token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: `/api/v1/promises/${session.promiseId}`,
    maxAge: session.maxAgeSeconds,
  });
}
