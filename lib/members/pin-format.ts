// 브라우저와 서버가 함께 쓰는 PIN 형식 검사. 해시(pin.ts)는 서버 전용이라 파일을 나눈다.

/** PIN은 숫자 4자리만 허용한다(MEMBER-06-01). */
export function isValidPin(pin: string): boolean {
  return /^[0-9]{4}$/.test(pin);
}
