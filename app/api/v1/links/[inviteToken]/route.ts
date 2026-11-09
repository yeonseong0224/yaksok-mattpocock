import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { linkExpired, linkNotFound } from "@/lib/links/errors";
import { findLink } from "@/lib/links/link-state";

/** 설정 중 화면의 재조회 간격(MEMBER-03-02) */
const SETUP_POLL_MS = 3000;

// 비참여자 기준 다음 화면(MEMBER-API-01 「화면 분기」). 본인 여부는 클라이언트가 /me로 판정한다.
const NEXT_ACTION: Record<string, string> = {
  unclaimed: "register_host",
  draft: "wait_setup",
  collecting: "join",
  closed: "view_result",
  confirmed: "view_result",
  cancelled: "cancelled",
};

// MEMBER-API-01 초대 링크 조회. 누구나 호출할 수 있고, 약속 내용은 공개하지 않는다.
// GET은 DB를 바꾸지 않는다(링크 미리보기만으로 약속·방장이 생기면 안 된다).
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ inviteToken: string }> },
) {
  const { inviteToken } = await context.params;
  const link = await findLink(prisma, inviteToken);
  if (!link) return linkNotFound();
  if (link.expired) return linkExpired();

  const promiseStatus = link.promiseStatus ?? "unclaimed";
  return NextResponse.json({
    inviteToken,
    promiseStatus,
    promiseId: link.promiseId,
    nextAction: NEXT_ACTION[promiseStatus],
    pollAfterMs: promiseStatus === "draft" ? SETUP_POLL_MS : null,
  });
}
