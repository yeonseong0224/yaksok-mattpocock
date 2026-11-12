import { isWithinRange, type SlotRange } from "@/lib/availability/slots";
import {
  validateStartSettings,
  type SettingsError,
  type StartSettings,
  type StartSettingsInput,
} from "./start-settings";

// 설정 변경 영향 계산(재설정·재조율 공용, STATE-04-02, 09-03, 09-04, MEMBER-07-03, 2026-11-11 결정).
// 새 설정을 검증하고, 지울 슬롯·버전을 올릴 참여자·제출 상태를 풀지를 정한다. DB와 시계에 의존하지 않는다.

export type ChangeImpactInput = {
  /** 지금 설정의 범위 */
  current: SlotRange;
  /** 바꿀 설정(모집 시작과 같은 모양) */
  next: StartSettingsInput;
  /** active 참여자와 그 슬롯(epoch 밀리초) */
  participants: { participantId: string; slots: number[] }[];
  /** 판정 시각(라우트는 잠금 후 DB 시각) */
  now: Date;
};

export type ChangeImpact =
  | {
      ok: true;
      settings: StartSettings;
      /** 고를 수 있는 날짜가 하나라도 늘었다(확대·이동). active 전원의 제출 상태를 풀고 버전 +1 */
      rangeGrew: boolean;
      /** 새 범위 밖이라 지울 슬롯(참여자별, 지울 것이 있는 참여자만) */
      removedSlots: { participantId: string; slots: number[] }[];
      /** 버전을 올릴 참여자 */
      versionBumped: string[];
    }
  | { ok: false; errors: SettingsError[] };

export function planSettingsChange(input: ChangeImpactInput): ChangeImpact {
  const validated = validateStartSettings(input.next, input.now, {
    keptStartDate: input.current.dateRangeStart,
  });
  const errors = validated.ok ? [] : [...validated.errors];
  // 정원은 현재 active 인원까지 줄일 수 있다(MEMBER-07-03). 범위(2~30) 오류가 이미 있으면 겹쳐 알리지 않는다.
  const active = input.participants.length;
  if (!errors.some((e) => e.field === "participantLimit") && input.next.participantLimit < active) {
    errors.push({
      field: "participantLimit",
      code: "CAPACITY_BELOW_ACTIVE_COUNT",
      message: `지금 ${active}명이 참여 중이라 정원을 ${active}명보다 줄일 수 없어요.`,
    });
  }
  // `!validated.ok`는 아래에서 settings 타입을 좁히려고 함께 본다.
  if (!validated.ok || errors.length > 0) return { ok: false, errors };
  const { settings } = validated;

  // 새 범위 밖 슬롯은 지우고 안쪽은 유지한다(STATE-04-02, 09-03).
  const removedSlots = input.participants
    .map(({ participantId, slots }) => ({
      participantId,
      slots: slots.filter((ms) => !isWithinRange(ms, settings)),
    }))
    .filter((p) => p.slots.length > 0);

  // 고를 수 있는 슬롯이 하나라도 늘면(확대·이동) 전원의 제출 상태를 풀고 버전 +1, 줄기만 하면 유지(STATE-09-04).
  const rangeGrew = grows(input.current, settings);
  const versionBumped = rangeGrew
    ? input.participants.map((p) => p.participantId)
    : removedSlots.map((p) => p.participantId);

  return { ok: true, settings, rangeGrew, removedSlots, versionBumped };
}

/** 새 범위가 지금 범위 밖의 날짜나 시각을 하나라도 포함하는가 */
function grows(current: SlotRange, next: SlotRange): boolean {
  return (
    next.dateRangeStart < current.dateRangeStart ||
    next.dateRangeEnd > current.dateRangeEnd ||
    next.dailyStartMinute < current.dailyStartMinute ||
    next.dailyEndMinute > current.dailyEndMinute
  );
}
