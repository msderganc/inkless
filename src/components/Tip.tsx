"use client";

import { Lightbulb, X } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "label-printer:dismissed-tips";

function readDismissed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** A one-time hint the user can dismiss (remembered in this browser). */
export function Tip({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  // Hidden until we know it wasn't dismissed, so it never flashes.
  const [show, setShow] = useState(false);
  useEffect(() => setShow(!readDismissed().includes(id)), [id]);
  if (!show) return null;
  return (
    <div className="flex max-w-xl items-start gap-2 rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-neutral-700">
      <Lightbulb
        size={14}
        className="mt-0.5 shrink-0 text-sky-700"
        aria-hidden
      />
      <span className="flex-1">{children}</span>
      <button
        type="button"
        className="rounded p-0.5 text-neutral-500 hover:bg-sky-100 hover:text-neutral-900"
        aria-label="Dismiss tip"
        title="Got it"
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(KEY, JSON.stringify([...readDismissed(), id]));
          } catch {
            // Storage unavailable: it just shows again next time.
          }
        }}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
