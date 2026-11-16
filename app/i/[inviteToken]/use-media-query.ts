"use client";

import { useSyncExternalStore } from "react";

/** 모바일 시간표를 쓰는 폭(Tailwind sm 미만). 이 폭 이상은 데스크톱 시간표 그대로다. */
export const MOBILE_QUERY = "(max-width: 39.99rem)";

/** 미디어 쿼리가 맞는지. 서버에서 그릴 때는 false(데스크톱)로 본다. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
