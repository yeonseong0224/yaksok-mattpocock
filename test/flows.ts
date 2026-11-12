import { expect } from "vitest";
import { POST as issueLinkRoute } from "@/app/api/v1/links/route";
import { GET as lookUpLinkRoute } from "@/app/api/v1/links/[inviteToken]/route";
import { POST as registerHostRoute } from "@/app/api/v1/links/[inviteToken]/host/route";
import { GET as getPromiseRoute } from "@/app/api/v1/promises/[promiseId]/route";
import { POST as startRoute } from "@/app/api/v1/promises/[promiseId]/start/route";
import { defaultVotingDeadline } from "@/lib/promises/start-settings";
import { addDays, kstDate } from "@/lib/time";
import type { TestClient } from "./http";

// 여러 테스트 파일이 쓰는 사용자 흐름 단계. 각 단계는 실제 API를 호출한다.

export async function issueLink(client: TestClient): Promise<string> {
  const res = await client.request(issueLinkRoute, { method: "POST", path: "/api/v1/links" });
  expect(res.status).toBe(201);
  return (res.body as { inviteToken: string }).inviteToken;
}

export function lookUpLink(client: TestClient, inviteToken: string) {
  return client.request(lookUpLinkRoute, {
    path: `/api/v1/links/${inviteToken}`,
    params: { inviteToken },
  });
}

export function registerHost(
  client: TestClient,
  inviteToken: string,
  body: unknown = { nickname: "승주", pin: "4827" },
) {
  return client.request(registerHostRoute, {
    method: "POST",
    path: `/api/v1/links/${inviteToken}/host`,
    params: { inviteToken },
    body,
  });
}

/** 링크를 발급하고 방장으로 등록한다. 클라이언트에 방장 세션 쿠키가 남는다. */
export async function createDraftPromise(client: TestClient) {
  const inviteToken = await issueLink(client);
  const res = await registerHost(client, inviteToken);
  expect(res.status).toBe(201);
  return { inviteToken, promiseId: (res.body as { promiseId: string }).promiseId };
}

export function getPromise(client: TestClient, promiseId: string) {
  return client.request(getPromiseRoute, {
    path: `/api/v1/promises/${promiseId}`,
    params: { promiseId },
  });
}

/** 지금 기준으로 통과하는 모집 시작 요청 본문. 시작일은 모레, 종료일은 그 7일 뒤. */
export function validStartBody(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  const startDate = addDays(kstDate(now), 2);
  const endDate = addDays(startDate, 7);
  return {
    title: "팀 저녁 모임",
    participantLimit: 4,
    dateRange: { startDate, endDate },
    votingDeadlineAt: defaultVotingDeadline(now, endDate).toISOString(),
    ...overrides,
  };
}

export function startCollecting(
  client: TestClient,
  promiseId: string,
  body: unknown = validStartBody(),
) {
  return client.request(startRoute, {
    method: "POST",
    path: `/api/v1/promises/${promiseId}/start`,
    params: { promiseId },
    body,
  });
}

// --- 참여자(티켓 04) ---

const promiseParams = (promiseId: string) => ({ promiseId });

export async function registerParticipant(
  client: TestClient,
  promiseId: string,
  body: unknown = { nickname: "혜승", pin: "1357" },
) {
  const { POST } = await import("@/app/api/v1/promises/[promiseId]/participants/route");
  return client.request(POST, {
    method: "POST",
    path: `/api/v1/promises/${promiseId}/participants`,
    params: promiseParams(promiseId),
    body,
  });
}

export async function getRoster(client: TestClient, promiseId: string) {
  const { GET } = await import("@/app/api/v1/promises/[promiseId]/participants/route");
  return client.request(GET, {
    path: `/api/v1/promises/${promiseId}/participants`,
    params: promiseParams(promiseId),
  });
}

export async function logIn(
  client: TestClient,
  promiseId: string,
  body: unknown = { nickname: "혜승", pin: "1357" },
) {
  const { POST } = await import("@/app/api/v1/promises/[promiseId]/auth/session/route");
  return client.request(POST, {
    method: "POST",
    path: `/api/v1/promises/${promiseId}/auth/session`,
    params: promiseParams(promiseId),
    body,
  });
}

export async function logOut(client: TestClient, promiseId: string) {
  const { DELETE } = await import("@/app/api/v1/promises/[promiseId]/auth/session/route");
  return client.request(DELETE, {
    method: "DELETE",
    path: `/api/v1/promises/${promiseId}/auth/session`,
    params: promiseParams(promiseId),
  });
}

export async function getMe(client: TestClient, promiseId: string) {
  const { GET } = await import("@/app/api/v1/promises/[promiseId]/me/route");
  return client.request(GET, {
    path: `/api/v1/promises/${promiseId}/me`,
    params: promiseParams(promiseId),
  });
}

/** 방장이 모집을 시작한 약속을 만든다. 방장 클라이언트에 방장 세션이 남는다. */
export async function createCollectingPromise(
  host: TestClient,
  startOverrides: Record<string, unknown> = {},
) {
  const created = await createDraftPromise(host);
  const started = await startCollecting(host, created.promiseId, validStartBody(startOverrides));
  expect(started.status).toBe(200);
  return created;
}

// --- 가능 시간(티켓 06) ---

/** 모집 시작 본문(validStartBody)의 시작일로부터 dayOffset일 뒤 KST hh:mm 슬롯의 ISO 문자열 */
export function slotAt(dayOffset: number, hhmm: string): string {
  const startDate = addDays(addDays(kstDate(new Date()), 2), dayOffset);
  return `${startDate}T${hhmm}:00+09:00`;
}

export async function submitAvailability(client: TestClient, promiseId: string, body: unknown) {
  const { PUT } = await import("@/app/api/v1/promises/[promiseId]/me/availability/route");
  return client.request(PUT, {
    method: "PUT",
    path: `/api/v1/promises/${promiseId}/me/availability`,
    params: { promiseId },
    body,
  });
}

export async function getAvailability(client: TestClient, promiseId: string) {
  const { GET } = await import("@/app/api/v1/promises/[promiseId]/availability/route");
  return client.request(GET, {
    path: `/api/v1/promises/${promiseId}/availability`,
    params: { promiseId },
  });
}

// --- 마감과 후보(티켓 08) ---

export async function closePromise(client: TestClient, promiseId: string) {
  const { POST } = await import("@/app/api/v1/promises/[promiseId]/close/route");
  return client.request(POST, {
    method: "POST",
    path: `/api/v1/promises/${promiseId}/close`,
    params: { promiseId },
  });
}

export async function getCandidates(client: TestClient, promiseId: string) {
  const { GET } = await import("@/app/api/v1/promises/[promiseId]/candidates/route");
  return client.request(GET, {
    path: `/api/v1/promises/${promiseId}/candidates`,
    params: { promiseId },
  });
}

// --- 확정(티켓 09) ---

export async function confirmPromise(client: TestClient, promiseId: string, startAt: unknown) {
  const { POST } = await import("@/app/api/v1/promises/[promiseId]/confirmation/route");
  return client.request(POST, {
    method: "POST",
    path: `/api/v1/promises/${promiseId}/confirmation`,
    params: { promiseId },
    body: { startAt },
  });
}

// --- 재설정(약속 관리 티켓 03) ---

export async function updateSettings(client: TestClient, promiseId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/v1/promises/[promiseId]/settings/route");
  return client.request(PATCH, {
    method: "PATCH",
    path: `/api/v1/promises/${promiseId}/settings`,
    params: { promiseId },
    body,
  });
}

export async function reopenPromise(client: TestClient, promiseId: string, body: unknown) {
  const { POST } = await import("@/app/api/v1/promises/[promiseId]/reopen/route");
  return client.request(POST, {
    method: "POST",
    path: `/api/v1/promises/${promiseId}/reopen`,
    params: { promiseId },
    body,
  });
}

// --- 취소(약속 관리 티켓 05) ---

export async function cancelPromise(client: TestClient, promiseId: string) {
  const { POST } = await import("@/app/api/v1/promises/[promiseId]/cancel/route");
  return client.request(POST, {
    method: "POST",
    path: `/api/v1/promises/${promiseId}/cancel`,
    params: { promiseId },
  });
}

// --- 탈퇴와 승계(약속 관리 티켓 06) ---

export async function leavePromise(client: TestClient, promiseId: string) {
  const { DELETE } = await import("@/app/api/v1/promises/[promiseId]/participants/me/route");
  return client.request(DELETE, {
    method: "DELETE",
    path: `/api/v1/promises/${promiseId}/participants/me`,
    params: { promiseId },
  });
}

// --- 내보내기(약속 관리 티켓 07) ---

export async function removeParticipant(
  client: TestClient,
  promiseId: string,
  participantId: string,
) {
  const { DELETE } =
    await import("@/app/api/v1/promises/[promiseId]/participants/[participantId]/route");
  return client.request(DELETE, {
    method: "DELETE",
    path: `/api/v1/promises/${promiseId}/participants/${participantId}`,
    params: { promiseId, participantId },
  });
}
