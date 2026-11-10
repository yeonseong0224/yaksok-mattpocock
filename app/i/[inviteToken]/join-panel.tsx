"use client";

import { useState } from "react";
import { buttonClass, Card, CardText, CardTitle } from "@/app/_components/ui";
import { ApiError, participantsUrl, postJson, sessionUrl } from "./api";
import { CredentialsForm, type CredentialErrors } from "./credentials-form";

// 링크로 들어온 사람의 참여 화면(Figma 05·06). 처음이면 참여자 등록, 다른 기기라면 로그인.
// 등록하기 전에는 약속 내용(이름·날짜·정원)을 보여주지 않는다(MEMBER-08-01).
export function JoinPanel({
  promiseId,
  canRegister,
  onJoined,
  onPromiseChanged,
  hostLogin = false,
}: {
  promiseId: string;
  /** 설정 중인 약속에 다른 기기의 방장이 로그인하는 경우 */
  hostLogin?: boolean;
  /** 마감·확정된 약속에는 새로 등록할 수 없고 로그인만 할 수 있다. */
  canRegister: boolean;
  onJoined: () => void;
  /** 등록 중에 마감되는 등 약속 상태가 바뀌었을 때 */
  onPromiseChanged: () => void;
}) {
  const [mode, setMode] = useState<"register" | "login">(canRegister ? "register" : "login");

  if (mode === "register" && canRegister) {
    return (
      <Card>
        <CardTitle>약속에 초대되었어요</CardTitle>
        <CardText>닉네임과 PIN을 정하면 바로 참여해요. 회원가입은 필요 없어요.</CardText>
        <CredentialsForm
          idPrefix="register"
          submitLabel="참여하고 시간 선택하기"
          pendingLabel="참여하는 중…"
          onSubmit={(credentials) =>
            submitOrError(
              () => postJson(participantsUrl(promiseId), credentials),
              onJoined,
              (error) => {
                switch (error.code) {
                  case "NICKNAME_TAKEN":
                    return {
                      nickname: (
                        <>
                          이미 사용 중인 닉네임이에요. 다른 이름을 입력하거나,{" "}
                          <button
                            type="button"
                            className="underline"
                            onClick={() => setMode("login")}
                          >
                            내가 등록했다면 로그인
                          </button>
                          해 주세요.
                        </>
                      ),
                    };
                  case "PROMISE_FULL":
                    return { form: "정원이 가득 찼어요. 방장에게 문의해 주세요." };
                  case "DEADLINE_PASSED":
                  case "INVALID_PROMISE_STATE":
                  case "PROMISE_NOT_OPEN":
                    onPromiseChanged();
                    return { form: error.message };
                  default:
                    return fieldOrForm(error);
                }
              },
            )
          }
          footer={
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`mt-3 ${buttonClass("secondary")}`}
            >
              이미 참여했어요 · 로그인
            </button>
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle>
        {hostLogin ? "방장 로그인" : canRegister ? "다시 로그인하기" : "참여자만 볼 수 있어요"}
      </CardTitle>
      <CardText>
        {hostLogin
          ? "방장으로 등록할 때 쓴 닉네임과 PIN을 입력하면 설정을 이어 갈 수 있어요."
          : canRegister
            ? "처음 참여할 때 쓴 닉네임과 PIN을 입력하세요."
            : "이 약속에 참여한 분은 닉네임과 PIN으로 로그인하면 결과를 볼 수 있어요."}
      </CardText>
      <CredentialsForm
        idPrefix="login"
        submitLabel="로그인"
        pendingLabel="확인하는 중…"
        checkNickname={false}
        pinHint="PIN을 잊었다면 다른 닉네임으로 새로 참여하세요."
        onSubmit={(credentials) =>
          submitOrError(
            () => postJson(sessionUrl(promiseId), credentials),
            onJoined,
            (error) => {
              if (error.code === "INVALID_CREDENTIALS") {
                return { form: "닉네임 또는 PIN이 올바르지 않아요." };
              }
              return fieldOrForm(error);
            },
          )
        }
        footer={
          canRegister && (
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`mt-3 ${buttonClass("secondary")}`}
            >
              처음이에요 · 새로 참여하기
            </button>
          )
        }
      />
    </Card>
  );
}

async function submitOrError(
  request: () => Promise<unknown>,
  onSuccess: () => void,
  toErrors: (error: ApiError) => CredentialErrors,
): Promise<CredentialErrors | void> {
  try {
    await request();
    onSuccess();
  } catch (error) {
    if (error instanceof ApiError) return toErrors(error);
    throw error;
  }
}

function fieldOrForm(error: ApiError): CredentialErrors {
  if (error.details?.field === "pin") return { pin: error.message };
  if (error.details?.field === "nickname") return { nickname: error.message };
  return { form: error.message };
}
