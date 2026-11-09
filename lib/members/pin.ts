import { randomBytes, scrypt } from "node:crypto";
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
