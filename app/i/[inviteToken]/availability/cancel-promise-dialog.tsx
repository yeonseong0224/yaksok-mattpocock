"use client";

import { cancelUrl, postJson } from "../api";
import { DangerConfirmDialog } from "../danger-confirm-dialog";

// 약속 취소 확인 팝업(약속 관리 티켓 05, STATE-API-07). 되돌릴 수 없음을 알린 뒤 방장이 한 번 더 누르면 취소한다.
export function CancelPromiseDialog({
  promiseId,
  onCancelled,
  onClose,
}: {
  promiseId: string;
  /** 취소됐다. 화면을 다시 불러오면 링크가 "취소된 약속"으로 바뀐다. */
  onCancelled: () => void;
  onClose: () => void;
}) {
  return (
    <DangerConfirmDialog
      title="약속을 취소할까요?"
      lines={[
        "취소하면 되돌릴 수 없어요.",
        "모든 참여자가 로그아웃되고, 링크를 열면 “취소된 약속입니다”만 보여요.",
      ]}
      actionLabel="약속 취소하기"
      onConfirm={async () => {
        await postJson(cancelUrl(promiseId));
        onCancelled();
      }}
      onClose={onClose}
    />
  );
}
