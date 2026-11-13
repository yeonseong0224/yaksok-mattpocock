import type { Prisma } from "@/prisma/generated/client";
import { expireParticipantSessions } from "./session";

/**
 * 멤버십 종료(본인 탈퇴·방장의 내보내기, MEMBER-10-01·10-02·10-03). 같은 트랜잭션에서 약속을 잠근 뒤 부른다.
 * status=cancelled, cancelled_at 기록, 모든 세션 즉시 만료(행 보존). 닉네임·PIN·슬롯·제출 시각·버전은 그대로 둔다.
 * active가 아니므로 정원·후보·히트맵·참석 명단에서 빠지고, 닉네임 UNIQUE로 같은 닉네임 재참여도 막힌다.
 * 방장이었다면 member로 내린다(약속당 방장 한 명, 유니크 인덱스). 후임을 올리는 것은 부르는 쪽이 이 다음에 한다.
 */
export async function endMembership(
  tx: Prisma.TransactionClient,
  participantId: string,
  now: Date,
) {
  await tx.participant.update({
    where: { id: participantId },
    data: { status: "cancelled", cancelledAt: now, role: "member" },
  });
  await expireParticipantSessions(tx, participantId, now);
}
