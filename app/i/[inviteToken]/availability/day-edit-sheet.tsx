"use client";

import { useState } from "react";
import { Button } from "@/app/_components/ui";
import { dayRangesError, type MinuteRange } from "@/lib/availability/day-edit";
import { dayLabel } from "../calendar";
import { BottomSheet } from "./bottom-sheet";
import { RangeRows } from "./range-rows";

// 날짜별 시간 수정 시트(모바일 시간표 개편). 모바일 시간표에서 날짜를 누르면 열린다.
// 그날 고른 시간을 시작·종료 구간으로 보여주고, 구간을 고치거나 더하거나 지운 뒤 "적용하기"로 그날 선택을 바꿔 쓴다.
// 적용은 제출 전 선택에만 반영되고(이 브라우저에 임시 저장), 제출해야 서버에 저장된다.
export function DayEditSheet({
  date,
  initialRanges,
  dailyStartMinute,
  dailyEndMinute,
  hasPast,
  onApply,
  onClose,
}: {
  date: string;
  initialRanges: MinuteRange[];
  dailyStartMinute: number;
  dailyEndMinute: number;
  /** 그날 지난 시간이 있는가(지난 시간은 적용해도 바뀌지 않는다고 알린다) */
  hasPast: boolean;
  onApply: (ranges: MinuteRange[]) => void;
  onClose: () => void;
}) {
  const [ranges, setRanges] = useState(initialRanges);
  const [error, setError] = useState<string | null>(null);

  function apply() {
    const message = dayRangesError(ranges);
    if (message) return setError(message);
    onApply(ranges);
  }

  return (
    <BottomSheet
      title={`${dayLabel(date)} 시간 수정`}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button onClick={apply}>적용하기</Button>
        </>
      }
    >
      <p className="text-xs leading-5 text-muted">시작·종료 시간을 직접 선택할 수 있어요.</p>
      <RangeRows
        ranges={ranges}
        onChange={(next) => {
          setRanges(next);
          setError(null);
        }}
        dailyStartMinute={dailyStartMinute}
        dailyEndMinute={dailyEndMinute}
        emptyText="아직 선택한 시간이 없어요."
      />
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      <p className="mt-3.5 rounded-lg border border-line bg-canvas p-3 text-[11px] leading-5 text-muted">
        적용한 뒤 &lsquo;가능 시간 제출&rsquo;을 눌러야 저장돼요.
        {hasPast && (
          <>
            <br />
            지난 시간은 바뀌지 않아요.
          </>
        )}
      </p>
    </BottomSheet>
  );
}
