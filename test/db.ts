import { prisma } from "@/lib/prisma";
import { hashSessionToken } from "@/lib/members/session";

// 테스트 준비 단계에서 시간이 흐른 상황을 만든다. 시계를 주입하지 않고 DB 시각 컬럼을 과거로 옮긴다(스펙 Testing Decisions).

/** 링크 발급 시각을 지금으로부터 `interval`(Postgres interval 문자열)만큼 과거로 옮긴다. */
export async function ageLink(inviteToken: string, interval: string) {
  await prisma.$executeRaw`
    UPDATE promise_links SET created_at = now() - ${interval}::interval
    WHERE invite_token = ${inviteToken}`;
}

/** 초안(draft) 생성 시각을 `interval`만큼 과거로 옮긴다(STATE-02-02 10분 만료 재현). */
export async function ageDraft(promiseId: string, interval: string) {
  await prisma.$executeRaw`
    UPDATE promises SET created_at = now() - ${interval}::interval
    WHERE id = ${promiseId}::uuid`;
}

/** 모집 마감 시각을 `interval`만큼 과거로 옮긴다(마감이 지난 상황 재현). */
export async function passDeadline(promiseId: string, interval = "1 minute") {
  await prisma.$executeRaw`
    UPDATE promises SET voting_deadline_at = now() - ${interval}::interval
    WHERE id = ${promiseId}::uuid`;
}

/**
 * 약속에 멤버와 그 세션을 직접 넣고 세션 토큰을 돌려준다.
 * 참여자 등록 API(티켓 04)가 생기기 전, 멤버 권한을 확인하는 테스트의 준비 단계용이다.
 */
export async function insertMemberSession(promiseId: string, nickname = "민수") {
  const { randomBytes } = await import("node:crypto");
  const member = await prisma.participant.create({
    data: { promiseId, nickname, normalizedNickname: nickname, passwordHash: "x", role: "member" },
  });
  const token = randomBytes(32).toString("base64url");
  await prisma.participantSession.create({
    data: {
      participantId: member.id,
      sessionTokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return token;
}
