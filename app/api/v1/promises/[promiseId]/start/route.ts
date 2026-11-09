import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { apiError, invalidRequest, noStore, readJsonObject } from "@/lib/api/responses";
import {
  AFTER_DEADLINE_SESSION_DAYS,
  authenticate,
  extendActiveSessions,
  sessionCookieUntil,
  setSessionCookie,
  type SessionCookie,
} from "@/lib/members/session";
import {
  draftExpired,
  forbidden,
  invalidPromiseState,
  promiseCancelled,
  promiseNotFound,
  unauthenticated,
} from "@/lib/promises/errors";
import {
  deleteDraft,
  findPromise,
  isDraftExpired,
  isUuid,
  lockPromise,
  settingsJson,
  type PromiseRow,
} from "@/lib/promises/promise-state";
import {
  parseStartSettingsBody,
  validateStartSettings,
  type SettingsError,
} from "@/lib/promises/start-settings";
import { addMinutes } from "@/lib/time";

type Outcome =
  | { kind: "not_found" }
  | { kind: "cancelled" }
  | { kind: "not_host" }
  | { kind: "draft_expired" }
  | { kind: "wrong_state"; status: string }
  | { kind: "invalid"; errors: SettingsError[] }
  | { kind: "started"; promise: PromiseRow; cookie: SessionCookie };

// STATE-API-02 설정 완료와 모집 시작. 방장만 draft → collecting으로 바꿀 수 있다.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ promiseId: string }> },
) {
  const rejected = rejectForeignOrigin(request);
  if (rejected) return rejected;

  const { promiseId } = await context.params;
  if (!isUuid(promiseId)) return invalidRequest();
  const body = await readJsonObject(request);
  const input = body && parseStartSettingsBody(body);
  if (!input) return invalidRequest();

  // 취소 여부는 세션 인증보다 먼저 본다(STATE-API-00).
  const existing = await findPromise(prisma, promiseId);
  if (!existing) return promiseNotFound();
  if (existing.status === "cancelled") return promiseCancelled();
  const viewer = await authenticate(prisma, request, promiseId);
  if (!viewer) return unauthenticated();

  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    // 링크 → 약속 순서로 잠근 뒤 상태·역할·DB 시각을 다시 읽는다.
    const promise = await lockPromise(tx, promiseId);
    if (!promise) return { kind: "not_found" };
    if (promise.status === "cancelled") return { kind: "cancelled" };
    const requester = await tx.participant.findUnique({ where: { id: viewer.participantId } });
    if (requester?.status !== "active" || requester.role !== "host") return { kind: "not_host" };
    if (isDraftExpired(promise)) {
      // 설정 완료보다 만료가 먼저다: 초안을 지우고 링크를 다음 방장에게 돌려준다(STATE-02-02).
      await deleteDraft(tx, promiseId);
      return { kind: "draft_expired" };
    }
    if (promise.status !== "draft") return { kind: "wrong_state", status: promise.status };

    const validated = validateStartSettings(input, promise.now);
    if (!validated.ok) return { kind: "invalid", errors: validated.errors };
    const { settings } = validated;

    await tx.promise.update({
      where: { id: promiseId },
      data: {
        title: settings.title,
        participantLimit: settings.participantLimit,
        dateRangeStart: new Date(`${settings.dateRangeStart}T00:00:00Z`),
        dateRangeEnd: new Date(`${settings.dateRangeEnd}T00:00:00Z`),
        dailyStartMinute: settings.dailyStartMinute,
        dailyEndMinute: settings.dailyEndMinute,
        durationMinutes: settings.durationMinutes,
        votingDeadlineAt: settings.votingDeadlineAt,
        status: "collecting",
      },
    });
    // 모든 세션을 마감 + 7일까지 늘린다(MEMBER-06-03).
    const sessionExpiresAt = addMinutes(
      settings.votingDeadlineAt,
      AFTER_DEADLINE_SESSION_DAYS * 24 * 60,
    );
    await extendActiveSessions(tx, promiseId, promise.now, sessionExpiresAt);

    const updated = await findPromise(tx, promiseId);
    return {
      kind: "started",
      promise: updated!,
      cookie: sessionCookieUntil(viewer, promise.now, sessionExpiresAt),
    };
  });

  switch (outcome.kind) {
    case "not_found":
      return promiseNotFound();
    case "cancelled":
      return promiseCancelled();
    case "not_host":
      return forbidden();
    case "draft_expired":
      return draftExpired();
    case "wrong_state":
      // 이미 collecting인 재요청도 409다. 성공 여부는 조회 API로 확인한다(STATE-API-02 5).
      return invalidPromiseState(outcome.status, ["draft"]);
    case "invalid":
      return apiError(422, "VALIDATION_FAILED", outcome.errors[0].message, {
        field: outcome.errors[0].field,
        errors: outcome.errors,
      });
    case "started": {
      const response = NextResponse.json({
        promiseId,
        promiseStatus: outcome.promise.status,
        settings: settingsJson(outcome.promise),
      });
      setSessionCookie(response, outcome.cookie);
      return noStore(response);
    }
  }
}
