import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rejectForeignOrigin } from "@/lib/api/origin";
import { generateInviteToken } from "@/lib/links/invite-token";

// 웹에서 링크 발급(신규 API). 인증 없음. 약속(promise) 행은 만들지 않는다.
export async function POST(request: NextRequest) {
  const forbidden = rejectForeignOrigin(request);
  if (forbidden) return forbidden;

  const link = await prisma.promiseLink.create({
    data: { inviteToken: generateInviteToken() },
  });
  return NextResponse.json({ inviteToken: link.inviteToken }, { status: 201 });
}
