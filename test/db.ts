import { prisma } from "@/lib/prisma";

// 테스트 준비 단계에서 시간이 흐른 상황을 만든다. 시계를 주입하지 않고 DB 시각 컬럼을 과거로 옮긴다(스펙 Testing Decisions).

/** 링크 발급 시각을 지금으로부터 `interval`(Postgres interval 문자열)만큼 과거로 옮긴다. */
export async function ageLink(inviteToken: string, interval: string) {
  await prisma.$executeRaw`
    UPDATE promise_links SET created_at = now() - ${interval}::interval
    WHERE invite_token = ${inviteToken}`;
}
