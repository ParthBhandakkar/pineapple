"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronUp, LogOut, User as UserIcon, FileText, CreditCard, Activity, Moon, Sun } from "lucide-react";

export type ProfileMenuItem = {
  id: string;
  label: string;
  icon: typeof UserIcon;
  onSelect: () => void;
  danger?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  anchor: "bottom-left" | "top-right";
  children?: ReactNode;
  user: { name: string; email: string };
  items: ProfileMenuItem[];
};

export function ProfilePopover({ open, onClose, anchor, user, items }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onClick = (event: MouseEvent) => {
      if (!ref.current) return;
      if (event.target instanceof Node && !ref.current.contains(event.target)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose]);

  if (!open) return null;

  const positionStyle: React.CSSProperties =
    anchor === "bottom-left"
      ? { bottom: "calc(100% + 8px)", left: 8 }
      : { top: "calc(100% + 8px)", right: 0 };

  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "U";

  return (
    <div ref={ref} className="profile-popover" style={positionStyle} role="menu">
      <div className="profile-popover-head">
        <div className="sidebar-avatar" aria-hidden>
          {initials}
        </div>
        <div className="profile-popover-head-meta">
          <strong>{user.name}</strong>
          <span title={user.email}>{user.email}</span>
        </div>
      </div>
      {items.map((item, idx) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={`profile-popover-item${item.danger ? " danger" : ""}`}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            role="menuitem"
            data-idx={idx}
          >
            <Icon className="icon" size={16} />
            <span style={{ flex: 1 }}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Re-export commonly used icons for caller convenience.
export { ChevronUp, LogOut, UserIcon, FileText, CreditCard, Activity, Moon, Sun };
