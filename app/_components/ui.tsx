import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// 와이어프레임 공통 틀: 상단 AppHeader + 회색 바탕 위 흰 카드(Figma 05·06·22)

export function AppHeader() {
  return (
    <header className="flex h-16 items-center border-b border-line bg-surface px-5">
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
      <main className="flex flex-1 justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6 sm:p-7">{children}</section>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-2xl font-bold">{children}</h1>;
}

export function CardText({ children }: { children: ReactNode }) {
  return <p className="mt-3 leading-7 text-muted">{children}</p>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

const BUTTON_BASE =
  "flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium transition-colors";

/** 버튼 모양. 링크(<Link>)를 버튼처럼 보이게 할 때도 쓴다. */
export const buttonClass = (variant: "primary" | "secondary" = "primary") =>
  `${BUTTON_BASE} ${
    variant === "primary"
      ? "bg-brand text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-brand/50"
      : "border border-line bg-surface text-brand-ink hover:bg-canvas"
  }`;

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return <button className={`${buttonClass(variant)} ${className}`} {...props} />;
}
