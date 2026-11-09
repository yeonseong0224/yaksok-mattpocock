"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./_components/ui";

// "새 약속 만들기" → 링크 발급 → 바로 그 링크 페이지로 이동(스펙 화면 흐름)
export function CreatePromiseButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function createPromise() {
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/v1/links", { method: "POST" });
      if (!res.ok) throw new Error(`링크 발급 실패: ${res.status}`);
      const { inviteToken } = (await res.json()) as { inviteToken: string };
      router.push(`/i/${inviteToken}`);
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={createPromise} disabled={pending}>
        {pending ? "링크 만드는 중…" : "새 약속 만들기"}
      </Button>
      {failed && (
        <p role="alert" className="mt-3 text-sm text-danger">
          링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      )}
    </>
  );
}
