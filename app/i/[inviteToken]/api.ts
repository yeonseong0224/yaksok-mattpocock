// 링크 페이지가 쓰는 API 응답 모양과 호출 도우미(MEMBER-API-01, STATE-API-01·02)

export type LinkInfo = {
  inviteToken: string;
  promiseStatus: "unclaimed" | "draft" | "collecting" | "closed" | "confirmed" | "cancelled";
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
