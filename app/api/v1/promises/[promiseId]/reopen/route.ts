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
  effectiveStatus,
  findPromise,
  isUuid,
  lockPromise,
  settingsJson,
  type PromiseRow,
} from "@/lib/promises/promise-state";
import { parseReopenBody, type SettingsError } from "@/lib/promises/start-settings";

type Outcome =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "not_host" }
  | { kind: "wrong_state"; status: string }
  | { kind: "invalid"; errors: SettingsError[] }
  | {
      kind: "reopened";
      promise: PromiseRow;
      changeImpact: SettingsChangeSummary & { confirmationCleared: boolean };
      cookie: SessionCookie | null;
    };

// STATE-API-06 재조율 시작. 방장만, 마감·확정된 약속을 새 마감과 함께 다시 모집 중으로 돌린다.
// 약속 이름·날짜 범위·정원도 함께 바꿀 수 있고, 확정 일정은 해제된다. 반영은 재설정과 같은 단계(applySettingsChange)다.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  const body = await readJsonObject(request);
  const input = body && parseReopenBody(body);
  if (!input) return invalidRequest();

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
    // 마감 시각이 지난 collecting은 마감된 것으로 본다(ADR-0001). 바로 collecting으로 다시 쓰므로 closed를 따로 저장하지 않는다.
    const status = effectiveStatus(promise);
    if (status !== "closed" && status !== "confirmed") return { kind: "wrong_state", status };

    const applied = await applySettingsChange(tx, promise, {
      title: input.title ?? promise.title!,
      participantLimit: input.participantLimit ?? promise.participantLimit!,
      dateRange: input.dateRange ?? {
        startDate: promise.dateRangeStart!,
        endDate: promise.dateRangeEnd!,
      },
      votingDeadlineAt: input.votingDeadlineAt,
    });
    if (!applied.ok) return { kind: "invalid", errors: applied.errors };
    // 다시 모집 중으로 돌리고 확정 일정을 비운다(STATE-API-06 처리 순서 3·8).
    await tx.promise.update({
      where: { id: promiseId },
      data: { status: "collecting", confirmedStartAt: null },
    });
    return {
      kind: "reopened",
      promise: applied.promise,
      changeImpact: {
        ...applied.summary,
        confirmationCleared: promise.confirmedStartAt !== null,
      },
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
      return invalidPromiseState(outcome.status, ["closed", "confirmed"]);
    case "invalid": {
      const { code, message, details } = settingsErrorBody(outcome.errors);
      return apiError(422, code, message, details);
    }
    case "reopened": {
      const response = NextResponse.json({
        promiseId,
        promiseStatus: "collecting",
        settings: settingsJson(outcome.promise),
        currentConfirmation: null,
        changeImpact: outcome.changeImpact,
      });
      if (outcome.cookie) setSessionCookie(response, outcome.cookie);
      return noStore(response);
    }
  }
}
