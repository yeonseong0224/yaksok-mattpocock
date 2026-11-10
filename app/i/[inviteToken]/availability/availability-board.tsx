"use client";

import { useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import { Button } from "@/app/_components/ui";
import { addDays, hhmmToMinute, kstDate, toKstIso } from "@/lib/time";
import {
  ApiError,
  availabilityUrl,
  getJson,
  closeUrl,
  myAvailabilityUrl,
  postJson,
  putJson,
  type Availability,
  type Me,
  type SubmitResult,
} from "../api";
import { weekStartOf } from "../calendar";
import { ParticipantRoster } from "../participant-home";
import { CandidateListPanel } from "./candidate-list";
import { DateJumpDialog } from "./date-jump-dialog";
import { toSortedKstIsos, useLocalDraft } from "./local-draft";
import { TimeDetailDialog } from "./time-detail-dialog";
import { WeekGrid, type SlotView } from "./week-grid";

// 가능 시간 화면(Figma 07·13~17·21). 슬롯을 눌러 내 가능 시간을 고르고 제출한다.
// 제출하기 전의 선택은 이 화면에만 있고, 다른 사람과 집계에는 제출한 값만 보인다(TIME-10-04).
// 캘린더가 보이는 동안 5초마다 현황을 다시 받는다. 탭이 숨겨지면 SWR이 멈춘다.

const POLL_MS = 5000;

const toMsSet = (slots: string[]) => new Set(slots.map((s) => Date.parse(s)));
const sameSet = (a: Set<number>, b: Set<number>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

type Notice = { tone: "info" | "error"; text: string } | null;

export function AvailabilityBoard({
  promiseId,
  title,
  me,
  onShowInvite,
  onLoggedOut,
  onSessionLost,
}: {
  promiseId: string;
  title: string;
  me: Me;
  onShowInvite: () => void;
  onLoggedOut: () => void;
  onSessionLost: () => void;
}) {
  const availability = useSWR<Availability, ApiError>(availabilityUrl(promiseId), getJson, {
    refreshInterval: POLL_MS,
  });
  const data = availability.data;

  // 제출하지 않은 내 선택. null이면 고친 것이 없어 서버에 제출된 값을 그대로 보여준다.
  // 새로고침해도 남도록 이 브라우저에 저장된 값에서 시작하고, 바뀔 때마다 저장한다(TIME-10-01).
  // 고치기 시작한 시점의 내 버전(baseVersion)을 함께 들고 있어야, 그 사이 다른 기기가 제출한 값을
  // 덮어쓰지 않고 409로 막을 수 있다(TIME-10-04, ERD 8.2). 폴링으로 받은 최신 버전을 보내면 안 된다.
  const [draft, setDraft] = useLocalDraft(promiseId, me.participantId);
  const [tab, setTab] = useState<"mine" | "heatmap">("mine");
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [inspecting, setInspecting] = useState<number | null>(null);
  // 후보는 모집 중에도 실시간으로 보이고(RESULT-09-01, 스토리 59), 마감 즉시 최종 후보가 보인다(RESULT-09-02).
  const [candidatesOpen, setCandidatesOpen] = useState(true);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);

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
  const showCandidates = candidatesOpen;
  const deadline = toKstIso(new Date(settings.votingDeadlineAt));
  const monthDay = (d: string) => d.slice(5).replace("-", ".");
  const maxCount = Math.max(0, ...counts.values());

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          <StatusBadge status={data.status} />
          <p className="mt-3 text-xs leading-5 text-muted">
            {monthDay(settings.dateRangeStart)} – {monthDay(settings.dateRangeEnd)}
            <br />
            마감 {monthDay(deadline.slice(0, 10))} {deadline.slice(11, 16)} KST
          </p>
        </div>
        <Button variant="secondary" onClick={onShowInvite}>
          초대 링크 보기
        </Button>
        <ParticipantRoster promiseId={promiseId} me={me} onLoggedOut={onLoggedOut} compact />
      </aside>

      <section className="min-w-0">
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
            onClick={() => setJumpOpen(true)}
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
        <p className="mt-3 text-xs text-muted">
          {tab === "mine"
            ? editable
              ? "30분 단위 · 빈 칸부터 드래그하면 추가, 선택한 칸부터 드래그하면 해제. 날짜나 오전·오후·저녁을 누르면 한 번에 고르거나 풀어요. 빗금 칸은 지난 시간이에요."
              : "마감되어 수정할 수 없어요."
            : "진할수록 더 많은 사람이 가능해요. 칸을 누르면 누가 가능한지 보여요."}
        </p>

        <div className="mt-3">
          <WeekGrid
            weekStart={shownWeek}
            dailyStartMinute={hhmmToMinute(settings.dailyStartTime)}
            dailyEndMinute={hhmmToMinute(settings.dailyEndTime)}
            mode={tab}
            total={data.totalParticipants}
            today={today}
            slotView={slotView}
            onSelect={editable && tab === "mine" ? applySelection : undefined}
            onInspect={tab === "heatmap" ? setInspecting : undefined}
          />
        </div>

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
            {editable && tab === "mine" && (
              <Button onClick={submit} disabled={pending} className="sm:w-48">
                {pending ? "제출하는 중…" : confirmEmpty ? "그래도 제출" : "가능 시간 제출"}
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
          />
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
          onClose={() => setInspecting(null)}
        />
      )}
      {jumpOpen && (
        <DateJumpDialog
          initialMonth={`${shownWeek.slice(0, 7)}-01`}
          rangeStart={settings.dateRangeStart}
          rangeEnd={settings.dateRangeEnd}
          onPick={(date) => {
            setWeekStart(weekStartOf(date));
            setJumpOpen(false);
          }}
          onClose={() => setJumpOpen(false)}
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
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-4 py-2 text-sm ${active ? "bg-surface font-medium text-brand-ink shadow-sm" : "text-muted"}`}
    >
      {children}
    </button>
  );
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

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h}시간` : "", m > 0 ? `${m}분` : ""].filter(Boolean).join(" ");
}
