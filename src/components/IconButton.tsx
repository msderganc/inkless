"use client";

import { type LucideIcon } from "lucide-react";

type Variant = "default" | "primary" | "danger" | "warning";

const VARIANTS: Record<Variant, string> = {
  default:
    "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100",
  primary: "border border-sky-600 bg-sky-600 text-white hover:bg-sky-700",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
  warning: "border border-amber-500 bg-amber-500 text-white hover:bg-amber-600",
};

interface Props {
  icon: LucideIcon;
  /** Accessible name and tooltip. */
  label: string;
  onClick?: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Toggle state for on/off buttons. */
  pressed?: boolean;
  size?: "sm" | "md" | "lg";
  /** Optional short text shown next to the icon (e.g. a count). */
  badge?: string;
}

const SIZES = { sm: "size-7", md: "size-8", lg: "h-10 min-w-10 px-2" } as const;
const ICON = { sm: 15, md: 17, lg: 20 } as const;

/** Icon-only button with a tooltip (title) and accessible name. */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  variant = "default",
  disabled,
  pressed,
  size = "md",
  badge,
}: Props) {
  const active = pressed
    ? "bg-neutral-800 text-white hover:bg-neutral-700 border-neutral-800"
    : VARIANTS[variant];
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1 rounded ${SIZES[size]} ${active} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <Icon size={ICON[size]} aria-hidden strokeWidth={2} />
      {badge && (
        <span className="text-sm font-medium tabular-nums">{badge}</span>
      )}
    </button>
  );
}
