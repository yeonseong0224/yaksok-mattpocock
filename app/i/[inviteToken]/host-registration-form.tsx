"use client";

import { useState, type FormEvent } from "react";
import { Button, Card, CardText, CardTitle } from "@/app/_components/ui";
import { normalizeNickname } from "@/lib/members/nickname";
import { isValidPin } from "@/lib/members/pin-format";

export type HostRegistered = {
  promiseId: string;
  participantId: string;
  nickname: string;
  draftExpiresAt: string;
};

type FieldErrors = { nickname?: string; pin?: string; form?: string };

const PIN_FORMAT_MESSAGE = "PIN은 숫자 4자리로 입력해 주세요.";

// 방장 등록 폼. Figma 05(참여 폼) 형식을 재사용하고 오류 표시는 Figma 06을 따른다.
export function HostRegistrationForm({
  inviteToken,
  onRegistered,
  onHostTaken,
  onInvalidLink,
}: {
  inviteToken: string;
  onRegistered: (host: HostRegistered) => void;
  onHostTaken: () => void;
  onInvalidLink: () => void;
}) {
  const [nickname, setNickname] = useState("");
  const [pin, setPin] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // 서버와 같은 규칙으로 먼저 확인한다. 최종 판정은 서버가 한다.
    const checked = normalizeNickname(nickname);
    const nextErrors: FieldErrors = {
      nickname: checked.ok ? undefined : checked.message,
      pin: isValidPin(pin) ? undefined : PIN_FORMAT_MESSAGE,
    };
    setErrors(nextErrors);
    if (nextErrors.nickname || nextErrors.pin) return;

    setPending(true);
    try {
      const res = await fetch(`/api/v1/links/${encodeURIComponent(inviteToken)}/host`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname, pin }),
      });
      if (res.status === 201) return onRegistered((await res.json()) as HostRegistered);
      // 먼저 등록한 사람이 있다 → 설정 중 화면으로(MEMBER-02-01)
      if (res.status === 409) return onHostTaken();
      if (res.status === 404 || res.status === 410) return onInvalidLink();
      if (res.status === 422) {
        const body = (await res.json()) as { message: string; details?: { field?: string } };
        const field = body.details?.field === "pin" ? "pin" : "nickname";
        return setErrors({ [field]: body.message });
      }
      setErrors({ form: "등록하지 못했어요. 잠시 후 다시 시도해 주세요." });
    } catch {
      setErrors({ form: "네트워크 오류로 등록하지 못했어요. 다시 시도해 주세요." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardTitle>새 약속을 만들어요</CardTitle>
      <CardText>처음 등록한 사람이 방장이 되어 약속을 설정해요.</CardText>

      <form onSubmit={submit} noValidate className="mt-6 flex flex-col">
        <Field id="nickname" label="닉네임" error={errors.nickname}>
          <input
            id="nickname"
            name="nickname"
            autoComplete="nickname"
            placeholder="닉네임을 입력하세요"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            aria-invalid={Boolean(errors.nickname)}
            aria-describedby={errors.nickname ? "nickname-error" : undefined}
            className={inputClass(Boolean(errors.nickname))}
          />
        </Field>

        <Field id="pin" label="내 응답 수정용 PIN" error={errors.pin}>
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="숫자 4자리"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            aria-invalid={Boolean(errors.pin)}
            aria-describedby={errors.pin ? "pin-error" : "pin-hint"}
            className={inputClass(Boolean(errors.pin))}
          />
        </Field>
        <p id="pin-hint" className="-mt-2 mb-6 text-xs text-muted">
          다시 방문할 때 같은 닉네임과 PIN으로 응답을 수정해요.
        </p>

        {errors.form && (
          <p role="alert" className="mb-3 text-sm text-danger">
            {errors.form}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "등록하는 중…" : "방장으로 시작하기"}
        </Button>
      </form>
    </Card>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label htmlFor={id} className="mb-2 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function inputClass(invalid: boolean) {
  return `h-11 w-full rounded-lg border bg-surface px-3.5 text-sm outline-none focus:ring-2 focus:ring-brand/30 ${
    invalid ? "border-danger text-danger" : "border-line"
  }`;
}
