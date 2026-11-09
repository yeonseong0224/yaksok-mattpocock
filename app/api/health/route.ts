import { prisma } from "@/lib/prisma";

// 연결 확인용. ERD 스키마의 테이블을 실제로 조회해 DB 연결과 마이그레이션 적용을 함께 확인한다.
export async function GET() {
  await prisma.promiseLink.count();
  return Response.json({ ok: true });
}
