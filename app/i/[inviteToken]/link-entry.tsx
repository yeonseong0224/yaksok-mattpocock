"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass, Card, CardText, CardTitle } from "@/app/_components/ui";
import { HostRegistrationForm, type HostRegistered } from "./host-registration-form";

type LinkInfo = {
  promiseStatus: "unclaimed" | "draft" | "collecting" | "closed" | "confirmed" | "cancelled";
  promiseId: string | null;
};

type View =
  | { kind: "loading" }
  | { kind: "invalid_link" }
  | { kind: "load_failed" }
  | { kind: "register_host" }
  | { kind: "wait_setup" }
  | { kind: "hosting"; host: HostRegistered }
  | { kind: "not_ready"; status: LinkInfo["promiseStatus"] };

function viewFor(info: LinkInfo): View {
  if (info.promiseStatus === "unclaimed") return { kind: "register_host" };
  if (info.promiseStatus === "draft") return { kind: "wait_setup" };
  return { kind: "not_ready", status: info.promiseStatus };
}

export function LinkEntry({ inviteToken }: { inviteToken: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/links/${encodeURIComponent(inviteToken)}`);
        if (cancelled) return;
        if (res.status === 404 || res.status === 410) return setView({ kind: "invalid_link" });
        if (!res.ok) return setView({ kind: "load_failed" });
        setView(viewFor((await res.json()) as LinkInfo));
      } catch {
        if (!cancelled) setView({ kind: "load_failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  switch (view.kind) {
    case "loading":
      return <p className="text-center text-muted">불러오는 중…</p>;
    case "invalid_link":
      return <InvalidLink />;
    case "load_failed":
      return (
        <Card>
          <CardTitle>링크를 불러오지 못했어요</CardTitle>
          <CardText>네트워크를 확인한 뒤 새로고침해 주세요.</CardText>
        </Card>
      );
    case "register_host":
      return (
        <HostRegistrationForm
          inviteToken={inviteToken}
          onRegistered={(host) => setView({ kind: "hosting", host })}
          onHostTaken={() => setView({ kind: "wait_setup" })}
          onInvalidLink={() => setView({ kind: "invalid_link" })}
        />
      );
    case "wait_setup":
      return (
        <Card>
          <CardTitle>방장이 약속을 설정 중입니다</CardTitle>
          <CardText>설정이 끝나면 이 링크에서 바로 참여할 수 있어요.</CardText>
        </Card>
      );
    case "hosting":
      return <Hosting host={view.host} />;
    case "not_ready":
      return (
        <Card>
          <CardTitle>약속에 참여하기</CardTitle>
          <CardText>참여자 등록 화면을 준비하고 있어요.</CardText>
        </Card>
      );
  }
}

// Figma 22 「만료되거나 잘못된 링크」
function InvalidLink() {
  return (
    <Card>
      <CardTitle>만료되거나 잘못된 링크</CardTitle>
      <CardText>초대 링크를 다시 확인하거나 방장에게 새 링크를 요청해 주세요.</CardText>
      <Link href="/" className={`mt-6 ${buttonClass("secondary")}`}>
        처음으로
      </Link>
    </Card>
  );
}

// 방장 설정 폼은 다음 단계(티켓 03)에서 이 자리에 들어온다.
function Hosting({ host }: { host: HostRegistered }) {
  const deadline = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(host.draftExpiresAt));
  return (
    <Card>
      <CardTitle>{host.nickname}님이 방장이에요</CardTitle>
      <CardText>
        약속 설정 화면을 준비하고 있어요. {deadline}까지 설정을 마치지 않으면 다른 사람이 방장이 될
        수 있어요.
      </CardText>
    </Card>
  );
}
