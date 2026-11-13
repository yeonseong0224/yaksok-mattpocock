// 변경 알림 배너(약속 관리 티켓 08, STATE-04-03·09-03·09-04, MEMBER-12-01).
// 변경 이력 테이블 없이(2026-11-11 결정) 브라우저가 마지막으로 본 상태와 지금 상태를 비교해 고른다.
// 순수 함수라 화면·저장소와 떨어져 있다. 저장은 seen-state.ts가 한다.

/** 브라우저가 약속·참여자별로 기억하는 "마지막으로 본 상태" */
export type SeenState = {
  status: "collecting" | "closed" | "confirmed";
  role: "host" | "member";
  title: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  participantLimit: number | null;
  votingDeadlineAt: string;
  /** 서버에 저장된 내 슬롯 수 */
  slotCount: number;
  /** 내 제출 여부 */
  submitted: boolean;
};

export type Banner = { id: "reopened" | "settings" | "resubmit" | "host"; text: string };

/**
 * @param now 지금 시각(서버 시각, epoch 밀리초). 지난번에 본 마감이 이미 지났다면 그때 약속은 마감된 것이다.
 *   확정 결과 화면처럼 시간표를 보지 않은 동안 마감·확정됐다가 다시 열려도 재조율로 알아챈다.
 */
export function bannersFor(prev: SeenState | null, curr: SeenState, now: number): Banner[] {
  // 처음 방문이면 비교할 것이 없다.
  if (!prev) return [];
  const banners: Banner[] = [];
  // 방장 본인의 재설정·재조율은 저장 직후 이미 안내를 봤다.
  const selfChange = prev.role === "host" && curr.role === "host";

  // 범위가 줄어 지워진 내 입력(내가 직접 고친 것은 설정이 바뀌지 않아 여기 오지 않는다)
  const removed = prev.slotCount - curr.slotCount;
  const removedNote = removed > 0 ? ` 범위 밖으로 나간 내 입력 ${removed}개가 지워졌어요.` : "";

  const prevOpen = prev.status === "collecting" && Date.parse(prev.votingDeadlineAt) > now;
  const reopened =
    !prevOpen &&
    curr.status === "collecting" &&
    Date.parse(curr.votingDeadlineAt) > Date.parse(prev.votingDeadlineAt);
  if (reopened && !selfChange) {
    banners.push({
      id: "reopened",
      text: `다시 조율 중이에요. 내 가능 시간을 확인해 주세요.${removedNote}`,
    });
  }

  // 재설정은 모집 중에만 일어난다. 마감·확정·재조율로 바뀐 마감 시각은 설정 변경으로 보지 않는다.
  const stillCollecting = prevOpen && curr.status === "collecting" && !reopened;
  if (stillCollecting && !selfChange && settingsChanged(prev, curr)) {
    banners.push({ id: "settings", text: `방장이 설정을 바꿨어요.${removedNote}` });
  }

  // 범위 확대로 제출 상태가 풀렸다(STATE-09-04). 내가 제출을 한 적이 없어 원래 미제출인 경우는 제외된다.
  if (curr.status === "collecting" && prev.submitted && !curr.submitted && !selfChange) {
    banners.push({
      id: "resubmit",
      text: "고를 수 있는 시간이 늘었어요. 다시 확인하고 제출해 주세요.",
    });
  }

  if (prev.role === "member" && curr.role === "host") {
    banners.push({ id: "host", text: "방장 권한을 넘겨받았어요." });
  }
  return banners;
}

function settingsChanged(prev: SeenState, curr: SeenState): boolean {
  return (
    prev.title !== curr.title ||
    prev.dateRangeStart !== curr.dateRangeStart ||
    prev.dateRangeEnd !== curr.dateRangeEnd ||
    prev.participantLimit !== curr.participantLimit ||
    Date.parse(prev.votingDeadlineAt) !== Date.parse(curr.votingDeadlineAt)
  );
}
