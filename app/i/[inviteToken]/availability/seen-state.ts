import type { SeenState } from "./change-banners";

// 약속·참여자별로 "마지막으로 본 상태"를 이 브라우저에 둔다(약속 관리 티켓 08, DB 변경 없음).
// localStorage가 막혀도(사생활 보호 모드 등) 화면은 동작해야 하므로 모든 접근을 감싼다. 그때는 배너만 뜨지 않는다.
// 다른 기기에서는 한 번 더 보일 수 있다(2026-11-11 결정).

const keyOf = (promiseId: string, participantId: string) =>
  `yaksok:last-seen:${promiseId}:${participantId}`;

export function loadSeen(promiseId: string, participantId: string): SeenState | null {
  try {
    const raw = window.localStorage.getItem(keyOf(promiseId, participantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; state?: SeenState };
    return parsed.v === 1 && parsed.state ? parsed.state : null;
  } catch {
    return null;
  }
}

export function saveSeen(promiseId: string, participantId: string, state: SeenState) {
  try {
    window.localStorage.setItem(keyOf(promiseId, participantId), JSON.stringify({ v: 1, state }));
  } catch {
    // 저장할 수 없으면 다음에 배너가 뜨지 않을 뿐이다.
  }
}
