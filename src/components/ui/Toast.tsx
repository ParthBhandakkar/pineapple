"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

export type ToastTone = "success" | "danger" | "warning" | "info";

type Toast = {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  duration: number;
};

type ToastContextValue = {
  show: (input: { tone?: ToastTone; title: string; body?: string; duration?: number }) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const ICONS: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  danger: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ToastContextValue["show"]>(
    ({ tone = "info", title, body, duration = 4500 }) => {
      counterRef.current += 1;
      const id = `${Date.now()}-${counterRef.current}`;
      const toast: Toast = { id, tone, title, body, duration };
      setToasts((current) => [...current.slice(-4), toast]);
    },
    [],
  );

  const value = useMemo<ToastContextValue>(() => ({ show }), [show]);

  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => dismiss(toast.id), toast.duration),
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];
          return (
            <div key={toast.id} className={`toast ${toast.tone}`}>
              <Icon size={18} className="toast-icon" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{toast.title}</strong>
                {toast.body && <p>{toast.body}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                style={{
                  border: 0,
                  background: "transparent",
                  color: "currentColor",
                  cursor: "pointer",
                  padding: 2,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
