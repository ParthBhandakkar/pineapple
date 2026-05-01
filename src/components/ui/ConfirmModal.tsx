"use client";

import { useEffect, type ReactNode } from "react";
import { ShieldCheck, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

export type ConfirmTone = "danger" | "warning" | "success" | "info";

type Props = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const ICON: Record<ConfirmTone, typeof ShieldCheck> = {
  danger: AlertTriangle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: ShieldCheck,
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "info",
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const Icon = ICON[tone];
  const confirmClass = tone === "danger" ? "btn btn-danger" : tone === "warning" ? "btn btn-accent" : "btn btn-primary";

  return (
    <div className="modal-backdrop" onClick={() => !loading && onCancel()}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className={`modal-icon-wrap ${tone}`}>
          <Icon size={22} />
        </div>
        <h3>{title}</h3>
        {description && (typeof description === "string" ? <p>{description}</p> : description)}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button type="button" className={confirmClass} onClick={onConfirm} disabled={loading}>
            {loading ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InfoModal({
  open,
  title,
  description,
  closeLabel = "Got it",
  tone = "info",
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  closeLabel?: string;
  tone?: ConfirmTone;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const Icon = ICON[tone];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className={`modal-icon-wrap ${tone}`}>
          <Icon size={22} />
        </div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
