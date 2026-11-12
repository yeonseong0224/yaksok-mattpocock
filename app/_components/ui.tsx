import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// 와이어프레임 공통 틀: 상단 AppHeader + 회색 바탕 위 흰 카드(Figma 05·06·22)

/** 헤더 왼쪽 자리. 화면별 버튼(예: 모바일 약속 정보 ☰)을 포털로 넣는다. */
export const HEADER_START_SLOT_ID = "app-header-start";

export function AppHeader() {
  return (
    <header className="flex h-16 items-center border-b border-line bg-surface px-5">
      <div id={HEADER_START_SLOT_ID} className="contents" />
      <Link href="/" className="text-lg font-bold text-brand-ink">
        ✓ 약속 잡기
      </Link>
    </header>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AppHeader />
      <main className="flex flex-1 justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

/** 가운데 좁은 흰 카드(Figma 04·05·06) */
export function Card({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-line bg-surface p-6 sm:p-7">
      {children}
    </section>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-2xl font-bold">{children}</h1>;
}

export function CardText({ children }: { children: ReactNode }) {
  return <p className="mt-3 leading-7 text-muted">{children}</p>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

/** danger는 되돌릴 수 없는 동작(약속 취소)에만 쓴다. */
type ButtonVariant = "primary" | "secondary" | "danger";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong disabled:bg-brand/50",
  secondary: "border border-line bg-surface text-brand-ink hover:bg-canvas disabled:text-muted",
  danger: "bg-danger text-white hover:bg-danger/90 disabled:bg-danger/50",
};

const BUTTON_BASE =
  "flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed";

/** 버튼 모양. 링크(<Link>)를 버튼처럼 보이게 할 때도 쓴다. */
export const buttonClass = (variant: ButtonVariant = "primary") =>
  `${BUTTON_BASE} ${VARIANT_CLASS[variant]}`;

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return <button className={`${buttonClass(variant)} ${className}`} {...props} />;
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-2 text-xs text-danger">
      {children}
    </p>
  );
}

export function inputClass(invalid = false) {
  return `h-11 w-full rounded-lg border bg-surface px-3.5 text-sm outline-none focus:ring-2 focus:ring-brand/30 ${
    invalid ? "border-danger text-danger" : "border-line"
  }`;
}
