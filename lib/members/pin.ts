import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;

/**
 * PIN 원문은 저장하지 않는다. 솔트를 붙인 scrypt 해시만 `password_hash`에 둔다.
 * scrypt는 Node 내장 메모리 하드 KDF라 bcrypt/argon2 대신 쓴다(member.md MEMBER-API-02 보안 정보).
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pin, salt, KEY_LENGTH);
  return ["scrypt", salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** 저장된 해시와 PIN이 맞는가 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltText, keyText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, "base64url");
  const actual = await scryptAsync(pin, Buffer.from(saltText, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

const dummyHash = hashPin("0000");

/**
 * 닉네임이 없을 때도 PIN 비교와 비슷한 시간을 쓰게 한다.
 * 응답 시간으로 닉네임이 있는지 알아낼 수 없게 하기 위해서다(MEMBER-API-04 처리 순서 4).
 */
export async function verifyAgainstDummy(pin: string): Promise<false> {
  await verifyPin(pin, await dummyHash);
  return false;
}
