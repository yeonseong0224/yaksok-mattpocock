import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 테스트 전용 DB. 개발 DB와 같은 로컬 Docker Postgres 안의 별도 데이터베이스다(.env의 TEST_DATABASE_URL).
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL이 설정되지 않았습니다. .env.example을 참고해 .env에 추가하세요.",
  );
}

// 테스트는 매번 모든 테이블을 비운다. 실수로 개발·운영 DB를 가리키지 않도록 막는다.
const testDatabaseName = new URL(testDatabaseUrl).pathname.slice(1);
if (!testDatabaseName.endsWith("_test")) {
  throw new Error(
    `TEST_DATABASE_URL의 데이터베이스 이름은 _test로 끝나야 합니다. (현재: ${testDatabaseName})`,
  );
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // 테스트는 하나의 테스트 DB를 공유하고 매 테스트마다 비우므로 파일을 순서대로 돌린다.
    fileParallelism: false,
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    env: { DATABASE_URL: testDatabaseUrl },
  },
});
