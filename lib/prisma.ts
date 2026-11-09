import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/prisma/generated/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL이 설정되지 않았습니다. .env 파일을 확인하세요.");
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// 연결의 세션 시간대를 UTC로 고정한다. @prisma/adapter-pg는 timestamptz의 오프셋을 무시하고 UTC로 읽고 쓰므로,
// DB 시간대가 Asia/Seoul(로컬 Docker)이면 저장값과 clock_timestamp() 비교가 9시간 어긋난다.
// 한국 기준 날짜 경계는 코드(lib/time.ts)에서 Asia/Seoul을 명시해 계산한다.
const adapter = new PrismaPg({ connectionString, options: "-c TimeZone=UTC" });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** 싱글턴 또는 트랜잭션 안의 클라이언트. 읽기 도우미가 둘 다 받을 때 쓴다. */
export type Db = Prisma.TransactionClient | typeof prisma;
