import { NextRequest } from "next/server";

/**
 * 라우트 핸들러를 HTTP 서버 없이 직접 호출하는 테스트 도우미.
 *
 * - 핸들러에 `NextRequest`를 넣고 `Response`를 받는다(주 seam).
 * - 클라이언트 하나가 브라우저 하나처럼 쿠키를 저장했다가, 경로(Path)가 맞는 요청에 다시 보낸다.
 *   기기 두 대를 흉내 내려면 클라이언트를 두 개 만든다.
 *
 * 핸들러는 쿠키를 `next/headers`의 `cookies()`가 아니라 `request.cookies`로 읽고
 * 응답의 Set-Cookie로 써야 이 도우미로 테스트할 수 있다.
 */

const BASE_URL = "http://localhost";

type RouteHandler<P> = (
  request: NextRequest,
  context: { params: Promise<P> },
) => Response | Promise<Response>;

export type TestRequest<P> = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 요청 경로. 예: `/api/v1/promises/abc/participants` */
  path: string;
  /** 동적 세그먼트 값. 예: `{ promiseId: "abc" }` */
  params?: P;
  /** JSON으로 직렬화해 보낸다. */
  body?: unknown;
  headers?: Record<string, string>;
};

export type TestResponse = {
  status: number;
  /** JSON 본문. 본문이 없거나 JSON이 아니면 null. */
  body: unknown;
  headers: Headers;
  raw: Response;
};

type StoredCookie = { name: string; value: string; path: string; expiresAt: number | null };

export function createTestClient() {
  const cookies = new Map<string, StoredCookie>();

  function cookieKey(name: string, path: string) {
    return `${path}\u0000${name}`;
  }

  function storeSetCookies(response: Response, requestPath: string) {
    for (const header of response.headers.getSetCookie()) {
      const cookie = parseSetCookie(header, requestPath);
      const key = cookieKey(cookie.name, cookie.path);
      if (cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) {
        cookies.delete(key);
      } else {
        cookies.set(key, cookie);
      }
    }
  }

  function cookiesFor(requestPath: string): StoredCookie[] {
    const now = Date.now();
    return (
      [...cookies.values()]
        .filter(
          (c) => (c.expiresAt === null || c.expiresAt > now) && pathMatches(requestPath, c.path),
        )
        // RFC 6265: 더 긴(구체적인) Path의 쿠키를 먼저 보낸다.
        .sort((a, b) => b.path.length - a.path.length)
    );
  }

  function cookieHeaderFor(requestPath: string): string | null {
    const matching = cookiesFor(requestPath);
    if (matching.length === 0) return null;
    return matching.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  return {
    async request<P = Record<string, never>>(
      handler: RouteHandler<P>,
      req: TestRequest<P>,
    ): Promise<TestResponse> {
      const headers = new Headers(req.headers);
      const cookieHeader = cookieHeaderFor(req.path);
      if (cookieHeader) headers.set("cookie", cookieHeader);
      let body: string | undefined;
      if (req.body !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(req.body);
      }

      const request = new NextRequest(new URL(req.path, BASE_URL), {
        method: req.method ?? "GET",
        headers,
        body,
      });
      const raw = await handler(request, {
        params: Promise.resolve((req.params ?? {}) as P),
      });

      storeSetCookies(raw, req.path);
      return { status: raw.status, body: await readJson(raw), headers: raw.headers, raw };
    },

    /** 이 클라이언트가 지금 `path`로 요청하면 보낼 쿠키 값. 없으면 undefined. */
    cookie(name: string, path = "/"): string | undefined {
      return cookiesFor(path).find((c) => c.name === name)?.value;
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.clone().text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseSetCookie(header: string, requestPath: string): StoredCookie {
  const [nameValue, ...attributes] = header.split(";").map((part) => part.trim());
  const eq = nameValue.indexOf("=");
  const name = nameValue.slice(0, eq);
  const value = nameValue.slice(eq + 1);

  let path = defaultPath(requestPath);
  let expiresAt: number | null = null;
  let maxAgeSeen = false;
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split("=");
    const key = rawKey.toLowerCase();
    const attrValue = rest.join("=");
    if (key === "path" && attrValue.startsWith("/")) {
      path = attrValue;
    } else if (key === "max-age") {
      maxAgeSeen = true;
      expiresAt = Date.now() + Number(attrValue) * 1000;
    } else if (key === "expires" && !maxAgeSeen) {
      expiresAt = new Date(attrValue).getTime();
    }
  }
  return { name, value, path, expiresAt };
}

function pathnameOf(requestPath: string): string {
  return new URL(requestPath, BASE_URL).pathname;
}

// RFC 6265 5.1.4: Path 속성이 없으면 요청 경로의 디렉터리
function defaultPath(requestPath: string): string {
  const pathname = pathnameOf(requestPath);
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

// RFC 6265 5.1.4: 경로 일치
function pathMatches(requestPath: string, cookiePath: string): boolean {
  const pathname = pathnameOf(requestPath);
  if (pathname === cookiePath) return true;
  if (!pathname.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || pathname[cookiePath.length] === "/";
}
