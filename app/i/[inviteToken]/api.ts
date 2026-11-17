// 링크 페이지가 쓰는 API 응답 모양과 호출 도우미(MEMBER-API-01, STATE-API-01·02)

export type LinkInfo = {
  inviteToken: string;
  promiseStatus: "unclaimed" | "draft" | OpenPromiseStatus | "cancelled";
  promiseId: string | null;
  nextAction: string;
  pollAfterMs: number | null;
};

export type PromiseSettings = {
  title: string | null;
  participantLimit: number | null;
  dateRange: { startDate: string | null; endDate: string | null };
  dailyTimeRange: { startTime: string | null; endTime: string | null };
  durationMinutes: number | null;
  votingDeadlineAt: string | null;
};

/** 참여자에게는 설정까지, 로그인하지 않은 사람에게는 상태만 온다. */
export type PromiseView =
  | { promiseId: string; promiseStatus: LinkInfo["promiseStatus"]; settings?: undefined }
  | {
      promiseId: string;
      promiseStatus: LinkInfo["promiseStatus"];
      draftExpiresAt: string | null;
      draftExpired: boolean;
      settings: PromiseSettings;
      currentConfirmation: Confirmation | null;
    };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * 약속이 취소됐다는 응답(409 PROMISE_CANCELLED)을 받으면 화면 전체에 알린다. 폴링이든 버튼이든
 * 어느 요청에서 알게 돼도 링크 화면이 링크를 다시 읽어 "취소된 약속"으로 바뀐다(약속 관리 티켓 05).
 */
export const PROMISE_CANCELLED_EVENT = "yaksok:promise-cancelled";

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  } | null;
  if (body?.code === "PROMISE_CANCELLED") window.dispatchEvent(new Event(PROMISE_CANCELLED_EVENT));
  return new ApiError(
    res.status,
    body?.code,
    body?.message ?? "요청을 처리하지 못했어요.",
    body?.details,
  );
}

/** SWR fetcher. 실패하면 ApiError를 던진다. */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export const linkUrl = (inviteToken: string) => `/api/v1/links/${encodeURIComponent(inviteToken)}`;
export const promiseUrl = (promiseId: string) => `/api/v1/promises/${promiseId}`;

export type Me = {
  participantId: string;
  nickname: string;
  role: "host" | "member";
  promiseStatus: LinkInfo["promiseStatus"];
  /** 이 기기 세션의 만료 시각(+09:00 ISO) */
  sessionExpiresAt: string;
};

export type Roster = {
  participantLimit: number | null;
  currentParticipantCount: number;
  participants: {
    participantId: string;
    nickname: string;
    role: "host" | "member";
    isMe: boolean;
  }[];
};

export async function deleteRequest(url: string): Promise<void> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 401) throw await toApiError(res);
}

/** 실패하면(401 포함) ApiError를 던지는 DELETE. 로그아웃과 달리 401을 성공으로 보면 안 되는 요청에 쓴다. */
export async function deleteJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export const meUrl = (promiseId: string) => `${promiseUrl(promiseId)}/me`;
export const participantsUrl = (promiseId: string) => `${promiseUrl(promiseId)}/participants`;
/** 본인 탈퇴·초안 없애기(STATE-API-08) */
export const leaveUrl = (promiseId: string) => `${participantsUrl(promiseId)}/me`;
/** 방장의 내보내기(MEMBER-API-08) */
export const participantUrl = (promiseId: string, participantId: string) =>
  `${participantsUrl(promiseId)}/${participantId}`;
export const sessionUrl = (promiseId: string) => `${promiseUrl(promiseId)}/auth/session`;

/** 참여자가 시간표·후보를 볼 수 있는 약속 상태(마감 계산 반영) */
export type OpenPromiseStatus = "collecting" | "closed" | "confirmed";

export type Availability = {
  status: OpenPromiseStatus;
  serverTime: string;
  settings: {
    title: string;
    participantLimit: number | null;
    dateRangeStart: string;
    dateRangeEnd: string;
    dailyStartTime: string;
    dailyEndTime: string;
    durationMinutes: number;
    votingDeadlineAt: string;
  };
  totalParticipants: number;
  participants: {
    participantId: string;
    nickname: string;
    isHost: boolean;
    availableSlots: string[];
  }[];
  me: { participantId: string; version: number; submitted: boolean; slots: string[] };
};

export type SubmitResult = {
  version: number;
  submitted: true;
  submittedAt: string;
  slots: string[];
  droppedSlotCount: number;
};

export async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export const settingsUrl = (promiseId: string) => `${promiseUrl(promiseId)}/settings`;

/** 재설정·재조율 응답의 영향 요약(STATE-API-03·06 changeImpact) */
export type { SettingsChangeSummary } from "@/lib/promises/change-impact";

export const availabilityUrl = (promiseId: string) => `${promiseUrl(promiseId)}/availability`;
export const myAvailabilityUrl = (promiseId: string) => `${promiseUrl(promiseId)}/me/availability`;

export type CandidateList = {
  promiseId: string;
  promiseStatus: OpenPromiseStatus;
  calculatedAt: string;
  durationMinutes: number;
  blocks: CandidateBlock[];
};

/** 하루 단위 후보 블록: 2명 이상 가능한 칸이 이어진 구간. best가 없으면 확정할 수 없다(candidate-blocks 02). */
export type CandidateBlock = {
  date: string;
  startAt: string;
  endAt: string;
  selectable: boolean;
  best: ScheduledTime | null;
};

export const candidatesUrl = (promiseId: string) => `${promiseUrl(promiseId)}/candidates`;
export const closeUrl = (promiseId: string) => `${promiseUrl(promiseId)}/close`;
export const cancelUrl = (promiseId: string) => `${promiseUrl(promiseId)}/cancel`;

/** 후보·확정 일정 하나(시작·끝, 참석 가능한 사람) */
export type ScheduledTime = {
  startAt: string;
  endAt: string;
  availableParticipantCount: number;
  participants: { participantId: string; nickname: string }[];
};

export type Confirmation = ScheduledTime & {
  /** 방장이 보고 있고 참석 가능 인원이 2명 미만이면 true */
  hostActionRequired: boolean;
};

export const confirmationUrl = (promiseId: string) => `${promiseUrl(promiseId)}/confirmation`;
