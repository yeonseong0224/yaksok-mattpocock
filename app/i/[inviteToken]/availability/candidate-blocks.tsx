"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import useSWR from "swr";
import { Button } from "@/app/_components/ui";
import { attendeesFor, type Respondent } from "@/lib/candidates/compute-candidates";
import { MINUTE_MS, SLOT_MS, toKstIso } from "@/lib/time";
import {
  candidatesUrl,
  getJson,
  type ApiError,
  type Availability,
  type CandidateBlock,
  type CandidateList,
  type ScheduledTime,
} from "../api";
import { clockRange, dayLabel, durationLabel } from "../calendar";

// 하루 단위 후보(candidate-blocks 02·03, 보내주신 m23-inline-detail.html).
// - 카드 하나 = 날짜 하나의 "2명 이상 가능한 칸이 이어진 구간". 인원은 약속 길이 내내 함께 가능한 최대 인원이다.
// - 방장(마감 뒤)은 카드를 누르면 아래로 상세가 펼쳐지고, 약속 길이 블록을 위아래로 끌어 시작 시간을 정한 뒤 확정한다.
//   블록 안 칸을 눌러도 그 칸부터 시작하고, 블록에 포커스를 두고 ↑↓로도 옮긴다.
// - 그 밖의 사람에게 카드는 그 날짜의 시간표(전체 현황)로 옮기는 버튼이다.
// - 약속 길이보다 짧거나 내내 함께 가능한 사람이 2명 미만인 구간은 회색 "선택 불가" 카드로 보여준다.

/** 상세의 한 줄(30분) 높이와 줄 사이 간격(px) */
const ROW_PX = 28;
const GAP_PX = 6;
const STEP_PX = ROW_PX + GAP_PX;
/** 확정할 수 있는 최소 인원(RESULT-04-01) */
const MIN_PARTICIPANTS = 2;

type Participants = Availability["participants"];

/** 참여자 가능 슬롯 → 계산 모듈 입력 */
function respondentsOf(participants: Participants): Respondent[] {
  return participants.map((p) => ({
    participantId: p.participantId,
    slotStarts: p.availableSlots.map((s) => new Date(s)),
  }));
}

/**
 * 블록 안에서 startMs로 시작하는 약속 길이 창. 서버 확정 규칙과 같다:
 * 확정할 수 있는 블록 안의 30분 경계 시작, 창 끝이 블록 안, 내내 함께 가능한 사람 2명 이상. 아니면 null.
 */
export function windowAt(
  blocks: CandidateBlock[],
  participants: Participants,
  startMs: number,
  durationMinutes: number,
): ScheduledTime | null {
  const endMs = startMs + durationMinutes * MINUTE_MS;
  const inBlock = blocks.some(
    (b) =>
      b.selectable &&
      startMs >= Date.parse(b.startAt) &&
      endMs <= Date.parse(b.endAt) &&
      (startMs - Date.parse(b.startAt)) % SLOT_MS === 0,
  );
  if (!inBlock) return null;
  const picked = namedWindow(participants, startMs, durationMinutes);
  return picked.participants.length >= MIN_PARTICIPANTS ? picked : null;
}

function namedWindow(
  participants: Participants,
  startMs: number,
  durationMinutes: number,
): ScheduledTime {
  const ids = new Set(
    attendeesFor({ startMs, durationMinutes, respondents: respondentsOf(participants) }),
  );
  const named = participants
    .filter((p) => ids.has(p.participantId))
    .map((p) => ({ participantId: p.participantId, nickname: p.nickname }));
  return {
    startAt: toKstIso(new Date(startMs)),
    endAt: toKstIso(new Date(startMs + durationMinutes * MINUTE_MS)),
    availableParticipantCount: named.length,
    participants: named,
  };
}

export function CandidateBlocksPanel({
  promiseId,
  pollMs,
  participants,
  total,
  onPick,
  onConfirm,
  onReopen,
  onCancelPromise,
  variant = "panel",
}: {
  promiseId: string;
  pollMs: number;
  /** 가능 시간 조회의 참여자(칸별 인원과 창의 참석자를 계산한다) */
  participants: Participants;
  /** 인원 표시의 분모(참여자 수) */
  total: number;
  /** 날짜를 그 주의 시간표로 옮긴다. */
  onPick: (date: string) => void;
  /** 방장·마감 후에만 넘긴다. 카드를 펼쳐 상세 시간을 고르고 확정할 수 있다. */
  onConfirm?: (window: ScheduledTime) => void;
  /** 방장·마감 후에만 넘긴다. 후보가 없을 때 다시 조율하기를 바로 고를 수 있다(RESULT-08-02). */
  onReopen?: (opener: HTMLElement) => void;
  /** 방장·마감 후에만 넘긴다. 후보가 없을 때 약속 취소도 바로 고를 수 있다(RESULT-08-02). */
  onCancelPromise?: (opener: HTMLElement) => void;
  /** panel: 시간표 아래·서랍 안, screen: 모바일 전체 화면(아래에 확정 줄 고정) */
  variant?: "panel" | "screen";
}) {
  const result = useSWR<CandidateList, ApiError>(candidatesUrl(promiseId), getJson, {
    refreshInterval: pollMs,
  });
  const data = result.data;
  // 펼친 블록(시작 시각으로 기억해 폴링으로 순서가 바뀌어도 유지)과 그 안에서 고른 창의 시작
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  const [start, setStart] = useState<number | null>(null);

  const blocks = data?.blocks ?? [];
  const opened = blocks.find((b) => b.startAt === openBlock && b.selectable) ?? null;
  const duration = data?.durationMinutes ?? 0;
  const chosen = opened && start !== null ? namedWindow(participants, start, duration) : null;
  const confirmable = chosen !== null && chosen.participants.length >= MIN_PARTICIPANTS;

  function toggle(block: CandidateBlock) {
    if (openBlock === block.startAt) {
      setOpenBlock(null);
      setStart(null);
    } else {
      setOpenBlock(block.startAt);
      setStart(Date.parse(block.best!.startAt));
    }
  }

  const footer = onConfirm && (
    <div
      className={
        variant === "screen"
          ? "border-t border-line bg-surface px-5 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          : "mt-3"
      }
    >
      <p className="mb-3 text-[12.5px] text-muted" aria-live="polite">
        {!opened || !chosen
          ? "날짜를 고르면 상세 시간을 정할 수 있어요"
          : `${dayLabel(opened.date)} ${rangeText(Date.parse(chosen.startAt), Date.parse(chosen.endAt))} · ${chosen.participants.length} / ${total}명 가능${
              confirmable ? "" : " · 2명 이상 함께 가능해야 확정할 수 있어요"
            }`}
      </p>
      <Button disabled={!confirmable} onClick={() => chosen && onConfirm(chosen)}>
        이 시간으로 확정
      </Button>
    </div>
  );

  const list = (
    <>
      {result.error && <p className="mt-3 text-sm text-danger">후보를 불러오지 못했어요.</p>}
      {!data && !result.error && <p className="mt-3 text-sm text-muted">불러오는 중…</p>}
      {data && !blocks.some((b) => b.selectable) && (
        // RESULT-08-01
        <div className="mt-3 text-sm text-muted">
          <p>2명 이상 {durationLabel(duration)} 동안 함께 가능한 시간이 없어요.</p>
          {onReopen && data.promiseStatus !== "collecting" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span>새 마감을 정해 다시 조율하거나 약속을 취소할 수 있어요.</span>
              <Button
                variant="secondary"
                onClick={(e) => onReopen(e.currentTarget)}
                className="sm:w-40"
              >
                다시 조율하기
              </Button>
              {onCancelPromise && (
                <button
                  type="button"
                  onClick={(e) => onCancelPromise(e.currentTarget)}
                  className="px-2 text-sm text-danger underline-offset-2 hover:underline"
                >
                  약속 취소
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {blocks.length > 0 && (
        <ol className="mt-3 flex flex-col gap-3">
          {blocks.map((block) => {
            const isOpen = opened?.startAt === block.startAt;
            return (
              <li key={block.startAt}>
                <BlockCard
                  block={block}
                  participants={participants}
                  total={total}
                  duration={duration}
                  open={isOpen}
                  expandable={onConfirm !== undefined}
                  onClick={() =>
                    onConfirm && block.selectable ? toggle(block) : onPick(block.date)
                  }
                />
                {isOpen && start !== null && (
                  <WindowPicker
                    block={block}
                    participants={participants}
                    total={total}
                    duration={duration}
                    start={start}
                    onStartChange={setStart}
                    onShowWeek={() => onPick(block.date)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3.5 text-xs leading-5 text-muted">
        하루 안에서 2명 이상 가능한 시간이 이어진 구간이 후보예요.{" "}
        {onConfirm ? "카드를 눌러 상세 시간을 정해요." : "카드를 누르면 그날 시간표로 옮겨요."}
      </p>
    </>
  );

  if (variant === "screen") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-5 pt-1 pb-6 scrollbar-none">
          {list}
        </div>
        {footer}
      </div>
    );
  }

  return (
    <section
      className="mt-4 rounded-xl border border-line bg-surface p-4"
      aria-labelledby="candidates-title"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h3 id="candidates-title" className="font-bold">
          {data?.promiseStatus === "collecting" ? "지금까지의 후보" : "최종 후보"}
        </h3>
        <p className="text-xs text-muted">
          {data?.promiseStatus === "collecting"
            ? "제출한 시간으로 계산한 중간 결과예요. 마감 전까지 바뀔 수 있어요."
            : "함께 가능한 인원이 많은 순, 같으면 빠른 순이에요."}
        </p>
      </div>
      {list}
      {footer}
    </section>
  );
}

function BlockCard({
  block,
  participants,
  total,
  duration,
  open,
  expandable,
  onClick,
}: {
  block: CandidateBlock;
  participants: Participants;
  total: number;
  duration: number;
  open: boolean;
  /** 방장: 누르면 상세가 펼쳐진다 */
  expandable: boolean;
  onClick: () => void;
}) {
  const from = Date.parse(block.startAt);
  const to = Date.parse(block.endAt);
  const minutes = (to - from) / MINUTE_MS;
  const count = useMemo(() => {
    if (block.best) return block.best.availableParticipantCount;
    // 선택 불가 블록은 칸별 최대 인원을 보여준다.
    let max = 0;
    for (let t = from; t < to; t += SLOT_MS) max = Math.max(max, slotCount(participants, t));
    return max;
  }, [block.best, from, to, participants]);
  const note = block.selectable
    ? `${durationLabel(minutes)} 연속 가능 · ${durationLabel(duration)} 약속 배치 가능`
    : minutes < duration
      ? `${durationLabel(minutes)} 연속 · 소요 시간보다 짧아 선택 불가`
      : `${durationLabel(minutes)} 연속 · ${durationLabel(duration)} 내내 함께 가능한 사람이 부족해 선택 불가`;
  const disabled = expandable && !block.selectable;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-expanded={expandable && block.selectable ? open : undefined}
      onClick={onClick}
      className={`block w-full rounded-[10px] border px-4 py-4 text-left ${
        open
          ? "rounded-b-none border-2 border-brand bg-brand/10 px-[15px] py-[15px]"
          : "border-line bg-surface hover:bg-canvas"
      } ${block.selectable ? "" : "opacity-55"} disabled:cursor-not-allowed disabled:hover:bg-surface`}
    >
      <span className="flex items-center justify-between gap-2.5">
        <span className={`text-[15.5px] font-bold ${open ? "text-brand-ink" : ""}`}>
          {dayLabel(block.date)}
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-[11.5px] whitespace-nowrap ${
            open ? "bg-brand text-white" : "bg-canvas text-muted"
          }`}
        >
          {count} / {total}명
        </span>
      </span>
      <span
        className={`mt-2 mb-1.5 block text-[19px] font-bold tracking-tight ${open ? "text-brand" : ""}`}
      >
        {rangeText(from, to)}
      </span>
      <span className="mb-2.5 block text-xs text-muted">{note}</span>
      <span className="block h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <i
          className={`block h-full rounded-full ${block.selectable ? "bg-brand" : "bg-muted/40"}`}
          style={{ width: `${total > 0 ? Math.min(100, (count / total) * 100) : 0}%` }}
        />
      </span>
    </button>
  );
}

/** 펼친 카드 아래의 상세: 30분 칸마다 인원, 그 위에 약속 길이 블록을 끌어 시작을 정한다. */
function WindowPicker({
  block,
  participants,
  total,
  duration,
  start,
  onStartChange,
  onShowWeek,
}: {
  block: CandidateBlock;
  participants: Participants;
  total: number;
  duration: number;
  /** 고른 창의 시작(epoch 밀리초) */
  start: number;
  onStartChange: (startMs: number) => void;
  onShowWeek: () => void;
}) {
  const from = Date.parse(block.startAt);
  const to = Date.parse(block.endAt);
  const rows: number[] = [];
  for (let t = from; t < to; t += SLOT_MS) rows.push(t);
  const durationRows = duration / 30;
  const maxRow = Math.max(0, rows.length - durationRows);
  const row = Math.min(maxRow, Math.max(0, (start - from) / SLOT_MS));
  const drag = useRef<{ y: number; row: number } | null>(null);

  const moveTo = (next: number) => {
    const clamped = Math.min(maxRow, Math.max(0, next));
    if (clamped !== row) onStartChange(from + clamped * SLOT_MS);
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, row };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    moveTo(drag.current.row + Math.round((e.clientY - drag.current.y) / STEP_PX));
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const delta = { ArrowUp: -1, ArrowDown: 1, Home: -maxRow, End: maxRow }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    moveTo(row + delta);
  }

  const windowEnd = from + (row + durationRows) * SLOT_MS;
  return (
    <div className="rounded-b-[10px] border-2 border-t-0 border-brand bg-surface px-4 pt-4 pb-3.5">
      <h4 className="mb-1 text-base font-bold tracking-tight">상세 시간을 정해주세요</h4>
      <p className="mb-3.5 text-xs text-muted">
        {durationLabel(duration)} 블록을 위아래로 끌거나 칸을 누르면 시작 시간이 바뀌어요
      </p>
      <div className="mb-3 flex items-center justify-between text-[12.5px]">
        <b className="font-bold">30분 단위</b>
        <span className="text-[11.5px] text-muted">색이 진할수록 가능 인원 많음</span>
      </div>
      <div className="relative grid grid-cols-[48px_1fr] items-center" style={{ rowGap: GAP_PX }}>
        {rows.map((t, i) => {
          const n = slotCount(participants, t);
          return (
            <div key={t} className="contents">
              <span className="text-xs text-muted">{clockRange(t, t + SLOT_MS).start}</span>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                onClick={() => moveTo(i)}
                className="flex items-center justify-end rounded-[5px] pr-2.5 text-[11.5px] text-muted"
                style={{
                  height: ROW_PX,
                  backgroundColor: `rgb(63 99 217 / ${(0.1 + (total > 0 ? n / total : 0) * 0.26).toFixed(3)})`,
                }}
              >
                {n}명
              </button>
            </div>
          );
        })}
        <div
          role="slider"
          tabIndex={0}
          aria-label="약속 시작 시간"
          aria-valuemin={0}
          aria-valuemax={maxRow}
          aria-valuenow={row}
          aria-valuetext={rangeText(from + row * SLOT_MS, windowEnd)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={onKeyDown}
          className="absolute right-0 left-12 grid cursor-grab touch-none place-items-center rounded-lg border-2 border-brand bg-brand/15 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 active:cursor-grabbing"
          style={{
            top: row * STEP_PX - 4,
            height: (durationRows - 1) * STEP_PX + ROW_PX + 8,
          }}
        >
          <span className="absolute -top-1 left-1/2 h-[7px] w-[46px] -translate-x-1/2 rounded-full bg-brand" />
          <span className="pointer-events-none rounded-lg bg-brand px-3 py-2 text-[13px] font-bold whitespace-nowrap text-white">
            {rangeText(from + row * SLOT_MS, windowEnd)}
            <em className="ml-1.5 text-xs font-semibold not-italic opacity-85">
              {durationLabel(duration)}
            </em>
          </span>
          <span className="absolute -bottom-1 left-1/2 h-[7px] w-[46px] -translate-x-1/2 rounded-full bg-brand" />
        </div>
      </div>
      <div className="mt-3.5 flex items-center justify-between gap-2">
        <p className="text-[11.5px] text-muted">↕ 블록을 끌면 시작 시간이 30분씩 이동해요</p>
        <button
          type="button"
          onClick={onShowWeek}
          className="shrink-0 text-[11.5px] text-brand underline-offset-2 hover:underline"
        >
          시간표에서 보기
        </button>
      </div>
    </div>
  );
}

function slotCount(participants: Participants, slotMs: number): number {
  return participants.filter((p) => p.availableSlots.some((s) => Date.parse(s) === slotMs)).length;
}

/** "18:00 – 20:00"(끝이 다음 날 00:00이면 24:00) */
function rangeText(startMs: number, endMs: number): string {
  const { start, end } = clockRange(startMs, endMs);
  return `${start} – ${end}`;
}
