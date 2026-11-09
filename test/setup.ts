import { afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";

// 매 테스트를 빈 DB에서 시작한다. 마이그레이션 기록을 뺀 모든 테이블을 비우므로 테이블이 늘어도 고칠 필요가 없다.
beforeEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")}`,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
