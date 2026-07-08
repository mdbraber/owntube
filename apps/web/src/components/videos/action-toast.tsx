"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ToastOptions = {
  /** Renders an Undo button that runs this and dismisses the toast. */
  undo?: () => void;
};

type ActionToastValue = {
  showToast: (message: string, options?: ToastOptions) => void;
};

const ActionToastContext = createContext<ActionToastValue>({
  showToast: () => {},
});

const DISMISS_MS = 3200;
const DISMISS_WITH_UNDO_MS = 5000;

/**
 * Single viewport-bottom toast for video-action feedback ("Added to queue",
 * "Video hidden — Undo"), replacing the per-component feedback bubbles that
 * used to float next to kebabs and rails. One toast at a time; a new message
 * replaces the current one.
 */
export function ActionToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    message: string;
    undo?: () => void;
    key: number;
  } | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showToast = useCallback(
    (message: string, options?: ToastOptions) => {
      clearTimer();
      setToast({ message, undo: options?.undo, key: Date.now() });
    },
    [clearTimer],
  );

  useEffect(() => {
    if (!toast) return;
    timerRef.current = window.setTimeout(
      () => setToast(null),
      toast.undo ? DISMISS_WITH_UNDO_MS : DISMISS_MS,
    );
    return clearTimer;
  }, [toast, clearTimer]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ActionToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex justify-center px-4"
      >
        {toast ? (
          <div
            key={toast.key}
            className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl bg-[hsl(var(--foreground))] py-2.5 pl-4 text-sm font-medium text-[hsl(var(--background))] shadow-lg animate-[ot-toast-in_180ms_ease-out] motion-reduce:animate-none"
            style={{ paddingRight: toast.undo ? "0.375rem" : "1rem" }}
          >
            <span className="truncate">{toast.message}</span>
            {toast.undo ? (
              <button
                type="button"
                className="shrink-0 rounded-lg px-3 py-1 font-semibold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--background)_/_0.15)]"
                onClick={() => {
                  toast.undo?.();
                  clearTimer();
                  setToast(null);
                }}
              >
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ActionToastContext.Provider>
  );
}

export function useActionToast(): ActionToastValue {
  return useContext(ActionToastContext);
}
