import { useEffect } from "react";

/** 팝업이 열려 있는 동안 Esc를 누르면 닫는다. */
export function useCloseOnEscape(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}
