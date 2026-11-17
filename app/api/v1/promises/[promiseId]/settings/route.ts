import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { apiError, invalidRequest, noStore, readJsonObject } from "@/lib/api/responses";
import {
  authenticate,
  sessionCookieUntil,
  setSessionCookie,
  type SessionCookie,
} from "@/lib/members/session";
import {
  applySettingsChange,
  settingsErrorBody,
  type SettingsChangeSummary,
} from "@/lib/promises/apply-settings-change";
import {
  forbidden,
  invalidPromiseState,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/promises/errors";
import {
  findPromise,
  isUuid,
  lockPromise,
  settingsJson,
  type PromiseRow,
} from "@/lib/promises/promise-state";
import { parseSettingsPatchBody, type SettingsError } from "@/lib/promises/start-settings";
import { toKstIso } from "@/lib/time";

type Outcome =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "not_host" }
  | { kind: "wrong_state"; status: string }
  | { kind: "invalid"; errors: SettingsError[] }
  | {
      kind: "updated";
      promise: PromiseRow;
      changeImpact: SettingsChangeSummary;
      cookie: SessionCookie | null;
    };

// STATE-API-03 모집 중 설정 변경(재설정). 방장만, 모집 중이고 마감 전일 때 이름·날짜 범위·정원·마감·소요 시간을 바꾼다.
// 범위가 바뀌면 영향 계산대로 슬롯·버전·제출 상태를 한 트랜잭션에서 고친다(applySettingsChange).
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  const body = await readJsonObject(request);
  const patch = body && parseSettingsPatchBody(body);
  if (!patch) return invalidRequest();

  // 취소 여부는 세션 인증보다 먼저 본다(STATE-API-00).
  const existing = await findPromise(prisma, promiseId);
  if (!existing) return promiseNotFound();
  if (existing.status === "cancelled") return promiseCancelled();
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) return unauthenticated();

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    // 잠금 후 최신 상태·권한·DB 시각으로 다시 판정한다.
    const promise = await lockPromise(tx, promiseId);
    if (!promise) return { kind: "not_found" };
    if (promise.status === "cancelled") return { kind: "cancelled" };
    const requester = await tx.participant.findUnique({ where: { id: viewer.participantId } });
    if (requester?.status !== "active" || requester.role !== "host") return { kind: "not_host" };
    if (promise.status === "collecting" && promise.votingDeadlineAt! <= promise.now) {
      // 마감이 지났다: 기한 마감을 먼저 반영하고 변경은 거절한다(ADR-0001).
      await tx.promise.update({ where: { id: promiseId }, data: { status: "closed" } });
      return { kind: "wrong_state", status: "closed" };
    }
    if (promise.status !== "collecting") return { kind: "wrong_state", status: promise.status };

    // 생략한 필드는 지금 값으로 채워 모집 시작과 같은 규칙으로 검증한다.
    const applied = await applySettingsChange(
      tx,
      promise,
      {
        title: patch.title ?? promise.title!,
        participantLimit: patch.participantLimit ?? promise.participantLimit!,
        dateRange: patch.dateRange ?? {
          startDate: promise.dateRangeStart!,
          endDate: promise.dateRangeEnd!,
        },
        votingDeadlineAt: patch.votingDeadlineAt ?? toKstIso(promise.votingDeadlineAt!),
        durationMinutes: patch.durationMinutes ?? promise.durationMinutes!,
      },
      { keptVotingDeadline: promise.votingDeadlineAt! },
    );
    if (!applied.ok) return { kind: "invalid", errors: applied.errors };
    return {
      kind: "updated",
      promise: applied.promise,
      changeImpact: applied.summary,
      cookie: applied.sessionExpiresAt
        ? sessionCookieUntil(viewer, promise.now, applied.sessionExpiresAt)
        : null,
    };
  });

  switch (outcome.kind) {
    case "not_found":
      return promiseNotFound();
    case "cancelled":
      return promiseCancelled();
    case "not_host":
      return forbidden();
    case "wrong_state":
      return invalidPromiseState(outcome.status, ["collecting"]);
    case "invalid": {
      const { code, message, details } = settingsErrorBody(outcome.errors);
      return apiError(422, code, message, details);
    }
    case "updated": {
      const response = NextResponse.json({
        promiseId,
        promiseStatus: outcome.promise.status,
        settings: settingsJson(outcome.promise),
        changeImpact: outcome.changeImpact,
      });
      if (outcome.cookie) setSessionCookie(response, outcome.cookie);
      return noStore(response);
    }
  }
}
