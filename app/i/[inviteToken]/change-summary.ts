import type { SettingsChangeSummary } from "./api";

/** 재설정·재조율 후 안내 문장(지워진 입력과 그 인원, 제출 상태가 풀린 인원, 후보 유무) */
export function changeSummaryMessage(lead: string, summary: SettingsChangeSummary): string {
  const parts = [lead];
  if (summary.removedSlotCount > 0) {
    parts.push(
      `범위 밖 입력 ${summary.removedSlotCount}개(${summary.removedSlotParticipantCount}명)를 지웠어요.`,
    );
  }
  if (summary.submissionsResetParticipantCount > 0) {
    parts.push(
      `고를 수 있는 날짜가 늘어 ${summary.submissionsResetParticipantCount}명의 제출 상태가 풀렸어요. 남은 선택은 그대로 집계돼요.`,
    );
  }
  if (summary.rangeChanged) {
    parts.push(summary.hasCandidates ? "지금 후보가 있어요." : "지금은 후보가 없어요.");
  }
  return parts.join(" ");
}
