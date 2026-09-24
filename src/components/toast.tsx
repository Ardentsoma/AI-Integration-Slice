"use client";

import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from "react";

type ToastType = "success" | "error" | "info";

interface ToastState {
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, type });
    timerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-6 right-6 z-[10000] flex items-center gap-2.5 rounded-lg px-5 py-3 text-sm text-white shadow-[0_10px_25px_rgba(10,18,42,0.25)] transition-all duration-300 ${
          toast
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-24 opacity-0"
        } ${
          toast?.type === "success"
            ? "border-l-4 border-green-500"
            : toast?.type === "error"
              ? "border-l-4 border-red-300"
              : "border-l-4 border-red-500"
        } bg-neutral-500`}
      >
        {toast?.message}
      </div>
    </ToastContext.Provider>
  );
}