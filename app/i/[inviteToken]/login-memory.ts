// 이 브라우저가 약속에 마지막으로 로그인해 있던 기억(약속 관리 티켓 07).
// 내보내지면 서버 세션이 즉시 만료돼 다음 조회가 401이 된다. 이 기억의 세션 만료 시각이 아직 남았는데
// 401이면 로그인 기간이 끝난 것이 아니라 멤버십이 끝난 것이다(내보내기, 또는 다른 기기에서 직접 나감).
// 이 기기에서 로그아웃·나가기를 하면 기억을 지운다. localStorage가 막혀도 동작하도록 모든 접근을 감싼다.

const keyOf = (promiseId: string) => `yaksok:last-login:${promiseId}`;

export function rememberLogin(promiseId: string, sessionExpiresAt: string) {
  try {
    window.localStorage.setItem(keyOf(promiseId), sessionExpiresAt);
  } catch {
    // 저장할 수 없으면 안내 없이 로그인 화면만 보여준다.
  }
}

export function forgetLogin(promiseId: string) {
  try {
    window.localStorage.removeItem(keyOf(promiseId));
  } catch {
    // 무시
  }
}

/** 모집 시작 뒤 세션은 마감 + 7일까지다(MEMBER-06-03). */
const AFTER_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 로그인이 끊긴 것이 멤버십 종료 때문인가. 내보내기는 마감 전에만 할 수 있으므로, 기억한 세션 만료에서
 * 7일을 뺀 시각(= 그때의 마감)보다 앞에서 끊겼을 때만 그렇게 본다. 그 뒤라면 로그인 기간이 끝난 것일 수 있다.
 */
export function membershipEnded(promiseId: string, now = Date.now()): boolean {
  try {
    if (typeof window === "undefined") return false;
    const expiresAt = window.localStorage.getItem(keyOf(promiseId));
    return expiresAt !== null && Date.parse(expiresAt) - AFTER_DEADLINE_MS > now;
  } catch {
    return false;
  }
}
