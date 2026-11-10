"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button, FieldError, inputClass } from "@/app/_components/ui";
import { normalizeNickname } from "@/lib/members/nickname";
import { isValidPin } from "@/lib/members/pin-format";

// 닉네임·PIN 입력 폼(Figma 05). 방장 등록, 참여자 등록, 로그인이 같이 쓴다. 오류 표시는 Figma 06을 따른다.

export type { Credentials } from "@/lib/members/credentials";
import type { Credentials } from "@/lib/members/credentials";
export type CredentialErrors = { nickname?: ReactNode; pin?: ReactNode; form?: ReactNode };

const PIN_FORMAT_MESSAGE = "PIN은 숫자 4자리로 입력해 주세요.";

export function CredentialsForm({
  idPrefix,
  submitLabel,
  pendingLabel,
  pinHint = "다시 방문할 때 같은 닉네임과 PIN으로 응답을 수정해요.",
  checkNickname = true,
  onSubmit,
  footer,
}: {
  /** 한 화면에 폼이 여럿일 때 입력란 id가 겹치지 않게 한다. */
  idPrefix: string;
  submitLabel: string;
  pendingLabel: string;
  pinHint?: ReactNode;
  /** 등록은 닉네임 규칙을 미리 확인한다. 로그인은 서버가 실패를 똑같이 돌려주므로 확인하지 않는다. */
  checkNickname?: boolean;
  /** 실패하면 보여줄 오류를 돌려준다. */
  onSubmit: (credentials: Credentials) => Promise<CredentialErrors | void>;
  footer?: ReactNode;
}) {
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [errors, setErrors] = useState<CredentialErrors>({});
  const [pending, setPending] = useState(false);
  const nicknameId = `${idPrefix}-nickname`;
  const pinId = `${idPrefix}-pin`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    // 서버와 같은 규칙으로 먼저 확인한다. 최종 판정은 서버가 한다.
    const checked = checkNickname ? normalizeNickname(nickname) : null;
    const nextErrors: CredentialErrors = {
      nickname: checked && !checked.ok ? checked.message : undefined,
      pin: isValidPin(pin) ? undefined : PIN_FORMAT_MESSAGE,
    };
    setErrors(nextErrors);
    if (nextErrors.nickname || nextErrors.pin) return;

    setPending(true);
    try {
      setErrors((await onSubmit({ nickname, pin })) ?? {});
    } catch {
      setErrors({ form: "네트워크 오류로 처리하지 못했어요. 다시 시도해 주세요." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 flex flex-col">
      <div className="mb-5">
        <label htmlFor={nicknameId} className="mb-2 block text-sm font-medium">
          닉네임
        </label>
        <input
          id={nicknameId}
          autoComplete="nickname"
          placeholder="닉네임을 입력하세요"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          aria-invalid={Boolean(errors.nickname)}
          aria-describedby={errors.nickname ? `${nicknameId}-error` : undefined}
          className={inputClass(Boolean(errors.nickname))}
        />
        <FieldError id={`${nicknameId}-error`}>{errors.nickname}</FieldError>
      </div>

      <div className="mb-2">
        <label htmlFor={pinId} className="mb-2 block text-sm font-medium">
          내 응답 수정용 PIN
        </label>
        <input
          id={pinId}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder="숫자 4자리"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          aria-invalid={Boolean(errors.pin)}
          aria-describedby={errors.pin ? `${pinId}-error` : `${pinId}-hint`}
          className={inputClass(Boolean(errors.pin))}
        />
        <FieldError id={`${pinId}-error`}>{errors.pin}</FieldError>
      </div>
      <p id={`${pinId}-hint`} className="mb-6 text-xs text-muted">
        {pinHint}
      </p>

      {errors.form && (
        <div role="alert" className="mb-3 text-sm text-danger">
          {errors.form}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
      {footer}
    </form>
  );
}
