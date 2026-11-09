import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

// 테스트 DB가 없으면 만들고, 커밋된 마이그레이션을 적용한다. (db push는 쓰지 않는다)
export default function setup(project: TestProject) {
  const databaseUrl = project.config.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("vitest.config.mts의 test.env.DATABASE_URL이 필요합니다.");

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}
