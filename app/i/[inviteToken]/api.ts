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

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  } | null;
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

export const meUrl = (promiseId: string) => `${promiseUrl(promiseId)}/me`;
export const participantsUrl = (promiseId: string) => `${promiseUrl(promiseId)}/participants`;
export const sessionUrl = (promiseId: string) => `${promiseUrl(promiseId)}/auth/session`;

/** 참여자가 시간표·후보를 볼 수 있는 약속 상태(마감 계산 반영) */
export type OpenPromiseStatus = "collecting" | "closed" | "confirmed";

export type Availability = {
  status: OpenPromiseStatus;
  serverTime: string;
  settings: {
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

export const availabilityUrl = (promiseId: string) => `${promiseUrl(promiseId)}/availability`;
export const myAvailabilityUrl = (promiseId: string) => `${promiseUrl(promiseId)}/me/availability`;

export type CandidateList = {
  promiseId: string;
  promiseStatus: OpenPromiseStatus;
  calculatedAt: string;
  candidates: {
    startAt: string;
    endAt: string;
    availableParticipantCount: number;
    participants: { participantId: string; nickname: string }[];
  }[];
};

export const candidatesUrl = (promiseId: string) => `${promiseUrl(promiseId)}/candidates`;
export const closeUrl = (promiseId: string) => `${promiseUrl(promiseId)}/close`;
