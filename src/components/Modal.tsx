"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { IconButton } from "./IconButton";

/**
 * Accessible modal dialog using the native <dialog> element (focus trap, Escape to close).
 * Focuses the element marked `data-autofocus` (or the first field) once open, and returns
 * focus to whatever was focused before when it closes.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** true = 3xl; "xl" = extra wide (e.g. the icon library). */
  wide?: boolean | "xl";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Keep the latest onClose without re-running the open/close effect.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    // React's autoFocus runs before showModal() and is ignored; focus explicitly instead.
    const target =
      d.querySelector<HTMLElement>("[data-autofocus]") ??
      d.querySelector<HTMLElement>("input, textarea, select");
    target?.focus();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    d.addEventListener("cancel", onCancel);
    return () => {
      d.removeEventListener("cancel", onCancel);
      if (d.open) d.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`m-auto max-h-[90vh] w-[calc(100vw-2rem)] ${wide === "xl" ? "max-w-6xl" : wide ? "max-w-3xl" : "max-w-lg"} rounded-lg border border-neutral-300 bg-white p-0 text-neutral-900 shadow-xl backdrop:bg-black/50`}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
    >
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <h2 className="font-semibold">{title}</h2>
        <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
      </div>
      <div className="max-h-[calc(90vh-3rem)] overflow-auto p-4">
        {children}
      </div>
    </dialog>
  );
}
