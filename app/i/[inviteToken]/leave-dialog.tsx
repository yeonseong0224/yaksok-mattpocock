"use client";

import { ApiError, deleteJson, leaveUrl } from "./api";
import { clearLocalDraft } from "./availability/local-draft";
import { DangerConfirmDialog } from "./danger-confirm-dialog";
import { forgetLogin } from "./login-memory";

// 본인 탈퇴·초안 없애기 확인 팝업(약속 관리 티켓 06, STATE-API-08).

export type LeaveKind =
  /** 일반 참여자의 탈퇴 */
  | { kind: "member" }
  /** 방장의 탈퇴: 후임이 있으면 그 사람에게 방장이 넘어가고, 없으면 약속이 취소된다 */
  | { kind: "host"; successorNickname: string | null }
  /** 설정 중(draft)에 방장이 초안을 없앤다 */
  | { kind: "draft" };

export function LeaveDialog({
  promiseId,
  participantId,
  leave,
  onLeft,
  onClose,
}: {
  promiseId: string;
  /** 이 기기의 임시 입력을 지울 참여자. 초안 없애기에는 없다. */
  participantId?: string;
  leave: LeaveKind;
  /** 나갔다(또는 초안을 없앴다). 링크 첫 화면으로 돌아간다. */
  onLeft: () => void;
  onClose: () => void;
}) {
  const { title, lines, action } = copyFor(leave);
  return (
    <DangerConfirmDialog
      title={title}
      lines={lines}
      actionLabel={action}
      onConfirm={async () => {
        // 401이면 나간 것이 아니다(로그인이 끝났을 뿐). 오류로 보여주고 다시 로그인하게 한다.
        await deleteJson(leaveUrl(promiseId));
        // 이 기기에 남은 제출하지 않은 입력도 지운다(초안에는 입력이 없다).
        if (participantId) clearLocalDraft(promiseId, participantId);
        // 이 기기에서 직접 나갔으니 "내보내졌어요" 안내를 띄우지 않는다.
        forgetLogin(promiseId);
        onLeft();
      }}
      failureMessage={(e) =>
        e instanceof ApiError && e.status === 401
          ? "로그인이 끝났어요. 다시 로그인한 뒤 나가 주세요."
          : null
      }
      onClose={onClose}
    />
  );
}

function copyFor(leave: LeaveKind): { title: string; lines: string[]; action: string } {
  switch (leave.kind) {
    case "draft":
      return {
        title: "이 약속을 없앨까요?",
        lines: [
          "설정 중인 약속이 지워져요.",
          "링크는 처음 상태로 돌아가서, 링크를 연 사람이 새로 약속을 만들 수 있어요.",
        ],
        action: "약속 없애기",
      };
    case "host":
      return leave.successorNickname
        ? {
            title: "이 약속에서 나갈까요?",
            lines: [
              `방장은 ${leave.successorNickname}님에게 넘어가요.`,
              "나가면 같은 닉네임으로 다시 들어올 수 없고, 고른 시간은 집계에서 빠져요.",
            ],
            action: "나가기",
          }
        : {
            title: "이 약속에서 나갈까요?",
            lines: [
              "남은 참여자가 없어서 약속이 취소돼요.",
              "취소하면 되돌릴 수 없고, 링크를 열면 “취소된 약속입니다”만 보여요.",
            ],
            action: "나가고 약속 취소",
          };
    case "member":
      return {
        title: "이 약속에서 나갈까요?",
        lines: [
          "나가면 같은 닉네임으로 다시 들어올 수 없어요.",
          "고른 시간은 후보와 참석 명단에서 빠져요.",
        ],
        action: "나가기",
      };
  }
}
