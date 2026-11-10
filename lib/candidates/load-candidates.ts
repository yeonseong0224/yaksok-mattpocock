import type { Db } from "@/lib/prisma";
import type { PromiseRow } from "@/lib/promises/promise-state";
import { computeCandidates } from "./compute-candidates";

// 후보 조회(티켓 08)와 확정 재검증(티켓 09)이 함께 쓰는 DB 읽기.
// 제출을 마친 active 참여자만 계산에 넣는다(RESULT-01-01). 미제출·탈퇴자는 빠진다.

export type CandidateWithNames = {
  startAt: Date;
  endAt: Date;
  participants: { participantId: string; nickname: string }[];
};

/** 약속의 현재 후보. 기준 시각은 약속 행을 읽은 DB 시각(promise.now)이다. */
export async function loadCandidates(db: Db, promise: PromiseRow): Promise<CandidateWithNames[]> {
  const respondents = await db.participant.findMany({
    where: { promiseId: promise.id, status: "active", availabilitySubmittedAt: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      nickname: true,
      availableSlots: { select: { slotStartAt: true } },
    },
  });
  const nicknames = new Map(respondents.map((r) => [r.id, r.nickname]));

  const candidates = computeCandidates({
    settings: {
      dateRangeStart: promise.dateRangeStart!,
      dateRangeEnd: promise.dateRangeEnd!,
      dailyStartMinute: promise.dailyStartMinute!,
      dailyEndMinute: promise.dailyEndMinute!,
      durationMinutes: promise.durationMinutes!,
    },
    respondents: respondents.map((r) => ({
      participantId: r.id,
      slotStarts: r.availableSlots.map((s) => s.slotStartAt),
    })),
    now: promise.now,
  });

  return candidates.map((c) => ({
    startAt: c.startAt,
    endAt: c.endAt,
    participants: c.participantIds.map((id) => ({
      participantId: id,
      nickname: nicknames.get(id)!,
    })),
  }));
}
