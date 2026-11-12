"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Button, HEADER_START_SLOT_ID } from "@/app/_components/ui";
import { slotRanges } from "@/lib/availability/repeat";
import type { SlotRange } from "@/lib/availability/slots";
import { addDays, hhmmToMinute, kstDate, toKstIso } from "@/lib/time";
import {
  ApiError,
  availabilityUrl,
  getJson,
  candidatesUrl,
  closeUrl,
  myAvailabilityUrl,
  postJson,
  putJson,
  type Availability,
  type CandidateList,
  type ScheduledTime,
  type Me,
  type SubmitResult,
} from "../api";
import { durationLabel, weekStartOf } from "../calendar";
import { ParticipantRoster } from "../participant-home";
import { PromiseDrawer } from "../promise-drawer";
import { CandidateListPanel } from "./candidate-list";
import { ConfirmDialog } from "./confirm-dialog";
import { DateJumpDialog } from "./date-jump-dialog";
import { HostSettingsDialog } from "./host-settings-dialog";
import { ReopenDialog } from "../reopen-dialog";
import { changeSummaryMessage } from "../change-summary";
import { MiniCalendar } from "./mini-calendar";
import { toSortedKstIsos, useLocalDraft } from "./local-draft";
import { RepeatDialog } from "./repeat-dialog";
import { RepeatMenu, type RepeatMode } from "./repeat-menu";
import { RepeatSheet, type RepeatSource } from "./repeat-sheet";
import { TimeDetailDialog } from "./time-detail-dialog";
import { WeekGrid, type RepeatTrigger, type SlotView, type TouchMode } from "./week-grid";

// 가능 시간 화면(Figma 07·13~17·21). 슬롯을 눌러 내 가능 시간을 고르고 제출한다.
// 제출하기 전의 선택은 이 화면에만 있고, 다른 사람과 집계에는 제출한 값만 보인다(TIME-10-04).
// 캘린더가 보이는 동안 5초마다 현황을 다시 받는다. 탭이 숨겨지면 SWR이 멈춘다.

const POLL_MS = 5000;

const toMsSet = (slots: string[]) => new Set(slots.map((s) => Date.parse(s)));
const sameSet = (a: Set<number>, b: Set<number>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

export type Notice = { tone: "info" | "error"; text: string } | null;
/** 반복 메뉴·팝업의 원본 날짜. origin은 닫을 때 포커스를 돌려줄 요소다. */
type RepeatOrigin = { date: string; origin: HTMLElement };
/**
 * 반복 메뉴를 연 방법. mouse(우클릭)는 그 자리의 팝업 메뉴, touch(길게 누르기)와 button(모바일 "반복 사용")은
 * 바텀시트로 연다. button은 원본 날짜가 없어 시트에서 먼저 고른다.
 */
type RepeatOpen =
  | (RepeatOrigin & { trigger: RepeatTrigger; x: number; y: number })
  | { trigger: "button"; origin: HTMLElement };

export function AvailabilityBoard({
  promiseId,
  title,
  participantLimit,
  me,
  onShowInvite,
  onLoggedOut,
  onSessionLost,
  onConfirmed,
  initialNotice = null,
}: {
  promiseId: string;
  title: string;
  /** 방장 포함 최대 인원(방장 설정 보기에 쓴다) */
  participantLimit: number | null;
  me: Me;
  onShowInvite: () => void;
  onLoggedOut: () => void;
  onSessionLost: () => void;
  /** 확정됐을 때(내가 했거나 폴링으로 알게 됐을 때) 결과 화면으로 넘어간다. */
  onConfirmed: () => void;
  /** 다른 화면에서 넘어오며 보여줄 안내(확정 결과 화면에서 재조율한 뒤 등) */
  initialNotice?: Notice;
}) {
  const availability = useSWR<Availability, ApiError>(availabilityUrl(promiseId), getJson, {
    refreshInterval: POLL_MS,
  });
  const data = availability.data;
  const { mutate: mutateAll } = useSWRConfig();

  // 제출하지 않은 내 선택. null이면 고친 것이 없어 서버에 제출된 값을 그대로 보여준다.
  // 새로고침해도 남도록 이 브라우저에 저장된 값에서 시작하고, 바뀔 때마다 저장한다(TIME-10-01).
  // 고치기 시작한 시점의 내 버전(baseVersion)을 함께 들고 있어야, 그 사이 다른 기기가 제출한 값을
  // 덮어쓰지 않고 409로 막을 수 있다(TIME-10-04, ERD 8.2). 폴링으로 받은 최신 버전을 보내면 안 된다.
  const [draft, setDraft] = useLocalDraft(promiseId, me.participantId);
  const [tab, setTab] = useState<"mine" | "heatmap">("mine");
  const [weekStart, setWeekStart] = useState<string | null>(null);
  // 날짜 이동 팝업이 처음 보여줄 달(YYYY-MM-01). null이면 닫혀 있다.
  const [jumpMonth, setJumpMonth] = useState<string | null>(null);
  // 방장 설정 보기(모집 중이면 바꾸기). 닫으면 포커스를 연 버튼으로 돌려준다.
  const [settingsFrom, setSettingsFrom] = useState<HTMLElement | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(initialNotice);
  const [inspecting, setInspecting] = useState<number | null>(null);
  // 후보는 모집 중에도 실시간으로 보이고(RESULT-09-01, 스토리 59), 마감 즉시 최종 후보가 보인다(RESULT-09-02).
  const [candidatesOpen, setCandidatesOpen] = useState(true);
  const [confirmClose, setConfirmClose] = useState(false);
  // 재조율(마감·확정 → 다시 모집 중) 팝업. 닫으면 포커스를 연 버튼으로 돌려준다.
  const [reopenFrom, setReopenFrom] = useState<HTMLElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [confirming, setConfirming] = useState<ScheduledTime | null>(null);
  // 우클릭 반복 메뉴(Figma 09)와 반복 팝업(Figma 10·11)
  const [repeatMenu, setRepeatMenu] = useState<RepeatOpen | null>(null);
  const [repeating, setRepeating] = useState<(RepeatOrigin & { mode: RepeatMode }) | null>(null);
  // 모바일 터치 조작(Figma 23): 선택 모드는 드래그로 슬롯 선택, 스크롤 모드는 화면 이동
  const [touchMode, setTouchMode] = useState<TouchMode>("select");
  // 후보 목록과 같은 키라 한 번만 조회된다. 확정 버튼을 보여줄 슬롯(표시 후보의 시작)을 알기 위해 쓴다.
  const candidates = useSWR<CandidateList, ApiError>(candidatesUrl(promiseId), getJson, {
    refreshInterval: POLL_MS,
  });

  const lastStatus = useRef(data?.status);
  useEffect(() => {
    const previous = lastStatus.current;
    lastStatus.current = data?.status;
    if (previous !== undefined && previous !== "confirmed" && data?.status === "confirmed") {
      onConfirmed();
    }
  }, [data?.status, onConfirmed]);

  const serverSlots = useMemo(() => toMsSet(data?.me.slots ?? []), [data?.me.slots]);
  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of data?.participants ?? []) {
      for (const s of p.availableSlots) {
        const key = Date.parse(s);
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return map;
  }, [data?.participants]);

  if (availability.error) {
    if (availability.error.status === 401) {
      return (
        <div className="mx-auto max-w-lg text-center">
          <p className="text-muted">로그인이 끝났어요. 다시 로그인해 주세요.</p>
          <Button variant="secondary" onClick={onSessionLost} className="mt-4">
            다시 로그인
          </Button>
        </div>
      );
    }
    return <p className="text-center text-muted">시간표를 불러오지 못했어요. 새로고침해 주세요.</p>;
  }
  if (!data) return <p className="text-center text-muted">불러오는 중…</p>;

  // 서버 버전이 기준 버전과 다르면(다른 기기 제출·범위 변경) 이 기기의 입력을 버리고 알린다(TIME-10-04).
  // 내 제출이 진행 중일 때는 내 제출로 버전이 오른 것이므로 건너뛴다.
  // 마감되면 더 이상 제출할 수 없으니 버린다. null로 바꾸면 저장된 입력도 지워진다.
  if (draft !== null && !pending) {
    const closed = data.status !== "collecting";
    const stale = draft.baseVersion !== data.me.version;
    if (closed || stale) {
      setDraft(null);
      // 버려진 입력이 최신 제출값과 같으면 화면이 바뀌지 않으니 알릴 것도 없다.
      if (!closed && !sameSet(draft.slots, toMsSet(data.me.slots))) {
        setNotice({
          tone: "error",
          text: "다른 기기에서 제출했거나 약속 범위가 바뀌어서, 이 기기에서 제출하지 않은 입력은 지우고 최신 내용을 보여드려요.",
        });
      }
    }
  }

  const { settings } = data;
  const slotRange: SlotRange = {
    dateRangeStart: settings.dateRangeStart,
    dateRangeEnd: settings.dateRangeEnd,
    dailyStartMinute: hhmmToMinute(settings.dailyStartTime),
    dailyEndMinute: hhmmToMinute(settings.dailyEndTime),
  };
  const serverNow = Date.parse(data.serverTime);
  const today = kstDate(new Date(serverNow));
  const editable = data.status === "collecting";
  const selected = draft?.slots ?? serverSlots;
  const dirty = draft !== null && !sameSet(draft.slots, serverSlots);
  // 처음 보여줄 주: 오늘이 날짜 범위 안이면 오늘, 아니면 범위 첫날이 있는 주
  const inRange = today >= settings.dateRangeStart && today <= settings.dateRangeEnd;
  const firstVisible = inRange ? today : settings.dateRangeStart;
  const shownWeek = weekStart ?? weekStartOf(firstVisible);
  const futureSelected = [...selected].filter((ms) => ms > serverNow);

  function slotView(slotMs: number, date: string): SlotView {
    if (date < settings.dateRangeStart || date > settings.dateRangeEnd) return { kind: "outside" };
    const view = { selected: selected.has(slotMs), count: counts.get(slotMs) ?? 0 };
    // 지난 슬롯(시작 ≤ 현재)은 고칠 수 없다(TIME-08-01). 기기 시계 대신 serverTime으로 판단한다.
    return slotMs <= serverNow ? { kind: "past", ...view } : { kind: "open", ...view };
  }

  // 드래그·클릭으로 고른 슬롯들을 한꺼번에 추가하거나 해제한다.
  function applySelection(slots: number[], add: boolean) {
    if (slots.length === 0) return;
    const next = new Set(selected);
    for (const slot of slots) {
      if (add) next.add(slot);
      else next.delete(slot);
    }
    // 드래그가 끝날 때마다 바뀐 선택이 이 브라우저에 저장된다(TIME-10-01).
    setDraft({ slots: next, baseVersion: draft?.baseVersion ?? data!.me.version });
    setConfirmEmpty(false);
    setNotice(null);
  }

  function closeRepeat(origin: HTMLElement) {
    setRepeatMenu(null);
    setRepeating(null);
    if (origin.isConnected) origin.focus();
  }

  async function submit() {
    // 가능한 시간이 하나도 없으면 한 번 더 확인한다(TIME-12-01).
    if (futureSelected.length === 0 && !confirmEmpty) return setConfirmEmpty(true);
    setConfirmEmpty(false);
    setPending(true);
    setNotice(null);
    try {
      const result = await putJson<SubmitResult>(myAvailabilityUrl(promiseId), {
        baseVersion: draft?.baseVersion ?? data!.me.version,
        slots: toSortedKstIsos(selected),
      });
      // 제출에 성공하면 이 브라우저의 임시 입력을 지운다(TIME-10-04).
      setDraft(null);
      await availability.mutate();
      setNotice({
        tone: "info",
        text:
          result.droppedSlotCount > 0
            ? "제출했어요. 범위 밖 시간은 제외하고 저장했어요."
            : "제출했어요. 다른 참여자 화면에도 곧 보여요.",
      });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setNotice({
          tone: "error",
          text: "제출하지 못했어요. 선택은 그대로예요. 다시 시도해 주세요.",
        });
      } else if (error.code === "AVAILABILITY_VERSION_CONFLICT") {
        // 다른 기기에서 먼저 제출했다. 이 기기의 입력을 버리고, 응답에 담긴 최신 값으로 바로 다시
        // 그린다. 다시 조회할 필요가 없다(time.md TIME-API-01, TIME-10-04).
        setDraft(null);
        const latest = error.details as Pick<Availability["me"], "submitted" | "slots"> & {
          currentVersion: number;
        };
        await availability.mutate(
          (current) =>
            current && {
              ...current,
              me: {
                ...current.me,
                version: latest.currentVersion,
                submitted: latest.submitted,
                slots: latest.slots,
              },
            },
          { revalidate: false },
        );
        setNotice({
          tone: "error",
          text: "다른 기기에서 먼저 저장했어요. 최신 내용을 확인해 주세요.",
        });
      } else if (error.status === 401) {
        onSessionLost();
      } else {
        await availability.mutate();
        setNotice({ tone: "error", text: error.message });
      }
    } finally {
      setPending(false);
    }
  }

  // 조기 마감(STATE-API-04). 방장에게, 모집 중일 때만 보인다.
  async function closeEarly() {
    if (!confirmClose) return setConfirmClose(true);
    setConfirmClose(false);
    setClosing(true);
    try {
      await postJson(closeUrl(promiseId));
      setCandidatesOpen(true);
      await availability.mutate();
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof ApiError ? error.message : "마감하지 못했어요. 다시 시도해 주세요.",
      });
    } finally {
      setClosing(false);
    }
  }

  const isHost = me.role === "host";
  // 확정은 방장만, 마감 뒤에만, 표시 후보 중에서만 한다(STATE-07-01, RESULT-11-02).
  const canConfirm = isHost && data.status === "closed";
  // 마감·확정 뒤 방장은 새 마감을 정해 다시 조율할 수 있다(STATE-09-01, RESULT-08-02).
  const canReopen = isHost && !editable;
  const inspectedCandidate =
    inspecting === null
      ? undefined
      : candidates.data?.candidates.find((c) => Date.parse(c.startAt) === inspecting);
  const showCandidates = candidatesOpen;
  const deadline = toKstIso(new Date(settings.votingDeadlineAt));
  const monthDay = (d: string) => d.slice(5).replace("-", ".");
  const maxCount = Math.max(0, ...counts.values());
  const submitLabel = pending ? "제출하는 중…" : confirmEmpty ? "그래도 제출" : "가능 시간 제출";

  /** 약속 정보. afterNavigate는 날짜 이동 뒤에 부른다(모바일 서랍을 닫는다). */
  const promiseInfo = (afterNavigate?: () => void) => (
    <>
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        <StatusBadge status={data.status} />
        <p className="mt-3 text-xs leading-5 text-muted">
          {monthDay(settings.dateRangeStart)} – {monthDay(settings.dateRangeEnd)}
          <br />
          마감 {monthDay(deadline.slice(0, 10))} {deadline.slice(11, 16)} KST
        </p>
      </div>
      <MiniCalendar
        key={shownWeek.slice(0, 7)}
        initialMonth={`${shownWeek.slice(0, 7)}-01`}
        rangeStart={settings.dateRangeStart}
        rangeEnd={settings.dateRangeEnd}
        today={today}
        weekStart={shownWeek}
        onPickDate={(date) => {
          setWeekStart(weekStartOf(date));
          afterNavigate?.();
        }}
        onOpenJump={(month) => {
          afterNavigate?.();
          setJumpMonth(month);
        }}
      />
      <Button variant="secondary" onClick={onShowInvite}>
        초대 링크 보기
      </Button>
      <ParticipantRoster promiseId={promiseId} me={me} onLoggedOut={onLoggedOut} compact />
      {isHost && (
        <Button
          variant="secondary"
          onClick={(e) => {
            afterNavigate?.();
            setSettingsFrom(e.currentTarget);
          }}
        >
          방장 설정 보기
        </Button>
      )}
    </>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      {/* 약속 정보: 데스크톱은 왼쪽에, 좁은 화면은 헤더 ☰로 여는 서랍에(모바일 와이어프레임 PromiseSlide) */}
      <aside className="hidden flex-col gap-4 lg:flex">{promiseInfo()}</aside>
      <PromiseDrawer>{(close) => promiseInfo(close)}</PromiseDrawer>

      <section className="min-w-0">
        {/* 좁은 화면에서는 약속 정보가 서랍에 들어가므로, 화면 읽기용 제목을 따로 둔다. */}
        <h1 className="sr-only lg:hidden">{title}</h1>
        <h2 className="text-xl font-bold">
          {tab === "mine" ? "가능한 시간을 골라 주세요" : "모두의 가능한 시간을 확인하세요"}
        </h2>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ToolButton onClick={() => setWeekStart(weekStartOf(firstVisible))}>오늘</ToolButton>
          <ToolButton label="이전 주" onClick={() => setWeekStart(addDays(shownWeek, -7))}>
            ‹
          </ToolButton>
          <ToolButton label="다음 주" onClick={() => setWeekStart(addDays(shownWeek, 7))}>
            ›
          </ToolButton>
          <button
            type="button"
            onClick={() => setJumpMonth(`${shownWeek.slice(0, 7)}-01`)}
            className="h-10 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-brand-ink hover:bg-canvas"
          >
            {weekLabel(shownWeek)}
          </button>
          <div className="ml-auto flex rounded-lg bg-canvas p-1" role="tablist">
            <Tab active={tab === "mine"} onClick={() => setTab("mine")}>
              내 가능 시간
            </Tab>
            <Tab active={tab === "heatmap"} onClick={() => setTab("heatmap")}>
              전체 현황
            </Tab>
          </div>
        </div>
        {editable && tab === "mine" && (
          // 터치 기기에서만 보인다(화면 폭이 아니라 포인터 종류 기준이라 태블릿에도 보인다).
          <div className="mt-3 hidden grid-cols-2 gap-1 rounded-lg bg-canvas p-1 pointer-coarse:grid">
            <Tab active={touchMode === "select"} onClick={() => setTouchMode("select")} tall>
              선택 모드
            </Tab>
            <Tab active={touchMode === "scroll"} onClick={() => setTouchMode("scroll")} tall>
              스크롤 모드
            </Tab>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          {tab === "mine" ? (
            editable ? (
              <>
                <span className="hidden pointer-coarse:inline">
                  {touchMode === "select"
                    ? "선택 모드 · 드래그하면 시간을 고르거나 풀어요. 화면을 움직이려면 스크롤 모드로 바꾸세요."
                    : "스크롤 모드 · 화면을 움직여요. 시간을 고르려면 선택 모드로 바꾸세요."}{" "}
                  날짜나 시간을 2초 동안 누르고 있으면 반복할 수 있어요.
                </span>
                <span className="pointer-coarse:hidden">
                  30분 단위 · 빈 칸부터 드래그하면 추가, 선택한 칸부터 드래그하면 해제. 날짜나
                  오전·오후·저녁을 누르면 한 번에 고르거나 풀어요. 빗금 칸은 지난 시간이에요.
                </span>
              </>
            ) : (
              "마감되어 수정할 수 없어요."
            )
          ) : (
            "진할수록 더 많은 사람이 가능해요. 칸을 누르면 누가 가능한지 보여요."
          )}
        </p>

        <div className="mt-3">
          <WeekGrid
            weekStart={shownWeek}
            dailyStartMinute={slotRange.dailyStartMinute}
            dailyEndMinute={slotRange.dailyEndMinute}
            mode={tab}
            total={data.totalParticipants}
            today={today}
            slotView={slotView}
            onSelect={editable && tab === "mine" ? applySelection : undefined}
            onInspect={tab === "heatmap" ? setInspecting : undefined}
            onRepeatMenu={
              editable && tab === "mine"
                ? (date, at, origin, trigger) => setRepeatMenu({ date, origin, trigger, ...at })
                : undefined
            }
            touchMode={touchMode}
          />
        </div>

        {/* 모바일: 반복 사용·제출은 화면 아래에 늘 보인다(Figma 23 "하단 제출 버튼은 항상 접근 가능") */}
        {editable && tab === "mine" && (
          <div className="sticky bottom-0 z-10 -mx-4 mt-3 grid grid-cols-2 gap-2 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
            <Button
              variant="secondary"
              disabled={selected.size === 0}
              onClick={(e) => setRepeatMenu({ trigger: "button", origin: e.currentTarget })}
            >
              반복 사용
            </Button>
            <Button onClick={submit} disabled={pending}>
              {submitLabel}
            </Button>
          </div>
        )}

        <BottomBar>
          <div className="text-sm text-muted">
            {tab === "heatmap" ? (
              `참여자 ${data.totalParticipants}명 · 한 칸에 최대 ${maxCount}명 가능`
            ) : (
              <>
                {futureSelected.length === 0
                  ? "아직 선택한 시간이 없어요"
                  : `${futureSelected.length}칸 · 총 ${durationLabel(futureSelected.length * 30)} 선택`}
                {dirty && (
                  <span className="ml-2 text-brand-ink">· 제출하지 않은 변경이 있어요</span>
                )}
                {!dirty && data.me.submitted && <span className="ml-2">· 제출 완료</span>}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {confirmEmpty && (
              <span className="text-sm text-danger">모두 불가능으로 제출됩니다. 계속할까요?</span>
            )}
            {confirmClose && (
              <span className="text-sm text-danger">
                {dirty
                  ? "제출하지 않은 내 변경은 사라지고, 아무도 시간을 고칠 수 없어요. 마감할까요?"
                  : "마감하면 아무도 시간을 고칠 수 없어요. 마감할까요?"}
              </span>
            )}
            <Button
              variant="secondary"
              onClick={() => setCandidatesOpen(!showCandidates)}
              aria-expanded={showCandidates}
              className="sm:w-32"
            >
              {showCandidates ? "후보 닫기" : "후보 보기"}
            </Button>
            {/* 모집 중에는 "일정 확정하기" 자리에 방장용 "조기 마감"(STATE-07-01, Figma와 다른 점) */}
            {editable && isHost && (
              <Button
                variant="secondary"
                onClick={closeEarly}
                disabled={closing}
                className="sm:w-32"
              >
                {closing ? "마감하는 중…" : confirmClose ? "마감하기" : "조기 마감"}
              </Button>
            )}
            {canReopen && (
              <Button
                variant="secondary"
                onClick={(e) => setReopenFrom(e.currentTarget)}
                className="sm:w-36"
              >
                다시 조율하기
              </Button>
            )}
            {canConfirm && (
              <Button
                onClick={() => {
                  setCandidatesOpen(true);
                  setNotice({ tone: "info", text: "아래 후보 중 확정할 시간을 골라 주세요." });
                }}
                className="sm:w-40"
              >
                일정 확정하기
              </Button>
            )}
            {editable && tab === "mine" && (
              <Button onClick={submit} disabled={pending} className="hidden sm:flex sm:w-48">
                {submitLabel}
              </Button>
            )}
          </div>
        </BottomBar>
        {showCandidates && (
          <CandidateListPanel
            promiseId={promiseId}
            pollMs={POLL_MS}
            onPick={(date) => {
              setWeekStart(weekStartOf(date));
              setTab("heatmap");
            }}
            onConfirm={canConfirm ? setConfirming : undefined}
            onReopen={canReopen ? (opener) => setReopenFrom(opener) : undefined}
          />
        )}
        {data.status === "confirmed" && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-brand/10 px-4 py-3 text-sm text-brand-ink">
            <span>약속이 확정됐어요.</span>
            <button type="button" onClick={onConfirmed} className="font-medium underline">
              확정 결과 보기
            </button>
          </div>
        )}
        {notice && (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={`mt-3 text-sm ${notice.tone === "error" ? "text-danger" : "text-brand-ink"}`}
          >
            {notice.text}
          </p>
        )}
        {!editable && (
          <p className="mt-3 text-sm text-brand-ink">
            마감되어 수정할 수 없어요. 방장의 최종 확정을 기다려 주세요.
          </p>
        )}
      </section>

      {inspecting !== null && (
        <TimeDetailDialog
          slotMs={inspecting}
          participants={data.participants}
          onConfirm={
            canConfirm && inspectedCandidate
              ? () => {
                  setConfirming(inspectedCandidate);
                  setInspecting(null);
                }
              : undefined
          }
          onClose={() => setInspecting(null)}
        />
      )}
      {confirming && (
        <ConfirmDialog
          promiseId={promiseId}
          candidate={confirming}
          hostParticipantId={me.participantId}
          onConfirmed={() => {
            setConfirming(null);
            onConfirmed();
          }}
          onCandidatesChanged={(latest) => {
            // 새 후보 목록으로 바로 다시 그리고 펼친다(스토리 69). 다시 조회하지 않는다.
            void candidates.mutate((current) => current && { ...current, candidates: latest }, {
              revalidate: false,
            });
            setCandidatesOpen(true);
          }}
          onClose={() => setConfirming(null)}
        />
      )}
      {repeatMenu && editable && repeatMenu.trigger !== "mouse" && (
        <RepeatSheet
          sources={repeatSources(selected)}
          initialDate={repeatMenu.trigger === "touch" ? repeatMenu.date : undefined}
          onChoose={(date, mode) => {
            setRepeatMenu(null);
            setRepeating({ date, origin: repeatMenu.origin, mode });
          }}
          onClose={() => closeRepeat(repeatMenu.origin)}
        />
      )}
      {repeatMenu && editable && repeatMenu.trigger === "mouse" && (
        <RepeatMenu
          date={repeatMenu.date}
          ranges={slotRanges(selected, repeatMenu.date)}
          x={repeatMenu.x}
          y={repeatMenu.y}
          onChoose={(mode) => {
            setRepeatMenu(null);
            setRepeating({ date: repeatMenu.date, origin: repeatMenu.origin, mode });
          }}
          onClose={() => closeRepeat(repeatMenu.origin)}
        />
      )}
      {repeating && editable && (
        <RepeatDialog
          source={repeating.date}
          selected={selected}
          range={slotRange}
          now={serverNow}
          today={today}
          initialMode={repeating.mode}
          onApply={(plan) => {
            // 제출 전 내 선택에 합집합으로 더한다. 이 브라우저에 임시 저장되고, 제출해야 서버에 반영된다.
            applySelection(plan.slots, true);
            closeRepeat(repeating.origin);
            setNotice({ tone: "info", text: "반복 시간을 추가했어요 · 제출하면 응답이 저장돼요" });
          }}
          onClose={() => closeRepeat(repeating.origin)}
        />
      )}
      {settingsFrom && (
        <HostSettingsDialog
          promiseId={promiseId}
          settings={{ ...settings, title, participantLimit }}
          editable={data.status === "collecting"}
          participants={data.participants.map((p) => ({
            participantId: p.participantId,
            slots: p.availableSlots.map(Date.parse),
          }))}
          // 이름·정원은 약속 조회에서, 범위·마감은 가능 시간 조회에서 온다. 후보도 바뀌니 모두 다시 불러온다.
          onSaved={() => void mutateAll(() => true)}
          onReopen={() => {
            // 설정 팝업을 닫고, 재조율 팝업을 닫을 때는 "방장 설정 보기" 버튼으로 돌아간다.
            setReopenFrom(settingsFrom);
            setSettingsFrom(null);
          }}
          onClose={() => {
            focusOpener(settingsFrom);
            setSettingsFrom(null);
          }}
        />
      )}
      {reopenFrom && (
        <ReopenDialog
          promiseId={promiseId}
          settings={{
            title,
            dateRangeStart: settings.dateRangeStart,
            dateRangeEnd: settings.dateRangeEnd,
            participantLimit,
            confirmed: data.status === "confirmed",
          }}
          onReopened={(summary) => {
            focusOpener(reopenFrom);
            setReopenFrom(null);
            setNotice({
              tone: "info",
              text: changeSummaryMessage("다시 모집을 시작했어요.", summary),
            });
            void mutateAll(() => true);
          }}
          onClose={() => {
            focusOpener(reopenFrom);
            setReopenFrom(null);
          }}
        />
      )}
      {jumpMonth && (
        <DateJumpDialog
          initialMonth={jumpMonth}
          rangeStart={settings.dateRangeStart}
          rangeEnd={settings.dateRangeEnd}
          onPick={(date) => {
            setWeekStart(weekStartOf(date));
            setJumpMonth(null);
          }}
          onClose={() => setJumpMonth(null)}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Availability["status"] }) {
  const text = status === "collecting" ? "조율 중" : status === "closed" ? "마감" : "확정";
  return (
    <span className="mt-2 inline-block rounded-md bg-brand/15 px-3 py-1 text-xs text-brand-ink">
      {text}
    </span>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-10 min-w-10 rounded-lg border border-line bg-surface px-3 text-sm text-brand-ink hover:bg-canvas"
    >
      {children}
    </button>
  );
}

function Tab({
  active,
  onClick,
  tall = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  /** 터치 영역 44px 이상(모바일 모드 전환, Figma 24) */
  tall?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-4 py-2 text-sm ${tall ? "min-h-11" : ""} ${active ? "bg-surface font-medium text-brand-ink shadow-sm" : "text-muted"}`}
    >
      {children}
    </button>
  );
}

/** 반복 원본으로 고를 수 있는 날짜: 내 선택이 있는 날짜(오름차순)와 그날의 시간 */
function repeatSources(selected: Set<number>): RepeatSource[] {
  const dates = [...new Set([...selected].map((ms) => kstDate(new Date(ms))))].sort();
  return dates.map((date) => ({ date, ranges: slotRanges(selected, date) }));
}

function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3">
      {children}
    </div>
  );
}

function weekLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const y = Number(weekStart.slice(0, 4));
  const m = Number(weekStart.slice(5, 7));
  const endPart =
    end.slice(5, 7) === weekStart.slice(5, 7)
      ? `${Number(end.slice(8, 10))}일`
      : `${Number(end.slice(5, 7))}월 ${Number(end.slice(8, 10))}일`;
  return `${y}년 ${m}월 · ${Number(weekStart.slice(8, 10))}–${endPart}`;
}

/** 팝업을 닫은 뒤 연 버튼으로 포커스를 돌려준다. 모바일 서랍에서 열었으면 그 버튼은 사라졌으니 헤더 ☰로. */
function focusOpener(opener: HTMLElement) {
  const target = opener.isConnected
    ? opener
    : document.querySelector<HTMLElement>(`#${HEADER_START_SLOT_ID} button`);
  target?.focus();
}
