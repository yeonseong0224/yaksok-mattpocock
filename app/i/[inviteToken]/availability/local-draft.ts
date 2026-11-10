import { useEffect, useState } from "react";
import { toKstIso } from "@/lib/time";

// 제출하지 않은 가능 시간 선택을 이 브라우저에 임시로 둔다(TIME-10-01·10-02·10-04).
// 키는 약속ID + 참여자ID, 값은 { v: 1, baseVersion, slots }(time.md 「시간 표기 규약」, 슬롯은 +09:00 ISO).
// baseVersion은 고치기 시작한 시점의 내 응답 버전이다. 서버 버전과 다르면 이 입력은 버린다.
// localStorage는 사생활 보호 모드 등에서 막힐 수 있으므로 모든 읽기·쓰기를 감싼다.

export type LocalDraft = { slots: Set<number>; baseVersion: number };

type Stored = { v: 1; baseVersion: number; slots: string[] };

const keyOf = (promiseId: string, participantId: string) =>
  `yaksok:availability-draft:${promiseId}:${participantId}`;

/** 슬롯들을 시각 순으로 +09:00 ISO 문자열로 */
export function toSortedKstIsos(slots: Iterable<number>): string[] {
  return [...slots].sort((a, b) => a - b).map((ms) => toKstIso(new Date(ms)));
}

function read(key: string): LocalDraft | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    if (stored.v !== 1 || !Number.isInteger(stored.baseVersion) || !Array.isArray(stored.slots)) {
      return null;
    }
    const slots = stored.slots.map((s) => Date.parse(s)).filter((ms) => !Number.isNaN(ms));
    return { slots: new Set(slots), baseVersion: stored.baseVersion };
  } catch {
    return null;
  }
}

function write(key: string, draft: LocalDraft | null) {
  try {
    if (draft === null) {
      window.localStorage.removeItem(key);
      return;
    }
    const stored: Stored = {
      v: 1,
      baseVersion: draft.baseVersion,
      slots: toSortedKstIsos(draft.slots),
    };
    window.localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // 저장하지 못해도 화면의 선택은 그대로 둔다. 새로고침하면 사라질 뿐이다.
  }
}

/**
 * 제출하지 않은 내 선택. 새로고침해도 남도록 이 브라우저에 저장된 값에서 시작하고,
 * 바뀔 때마다 저장한다. null로 두면(제출 성공·버전 충돌·마감 등) 저장된 것도 지운다.
 */
export function useLocalDraft(promiseId: string, participantId: string) {
  const key = keyOf(promiseId, participantId);
  const [draft, setDraft] = useState<LocalDraft | null>(() => read(key));
  useEffect(() => write(key, draft), [key, draft]);
  return [draft, setDraft] as const;
}

/** 로그아웃하면 이 기기의 제출하지 않은 입력을 지운다(스토리 32). */
export function clearLocalDraft(promiseId: string, participantId: string) {
  write(keyOf(promiseId, participantId), null);
}
