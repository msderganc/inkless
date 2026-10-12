"use client";

import {
  ChevronDown,
  ChevronUp,
  Circle,
  Eye,
  EyeOff,
  Frame,
  Image as ImageIcon,
  Lock,
  Minus,
  Shapes,
  Square,
  Type,
  Unlock,
} from "lucide-react";
import { useState } from "react";
import { type DesignElement, elementTitle } from "~/lib/design";

const kindIcon = (el: DesignElement) => {
  switch (el.kind) {
    case "text":
      return Type;
    case "icon":
      return Shapes;
    case "image":
      return ImageIcon;
    case "shape":
      return { rect: Square, ellipse: Circle, line: Minus, frame: Frame }[
        el.shape
      ];
  }
};

const rowButton =
  "rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 disabled:opacity-30";

/**
 * Every item on the label, topmost first: select (Shift/Ctrl adds), rename (double-click),
 * reorder, hide and lock.
 */
export function LayersPanel({
  elements,
  selectedIds,
  onSelect,
  onPatch,
  onReorder,
}: {
  elements: DesignElement[];
  selectedIds: string[];
  onSelect: (id: string, additive: boolean) => void;
  onPatch: (id: string, patch: Partial<DesignElement>) => void;
  /** Move one step towards the top ("up") or bottom ("down") of the stack. */
  onReorder: (id: string, dir: "up" | "down") => void;
}) {
  const [renaming, setRenaming] = useState<string>();
  const topFirst = [...elements].reverse();

  if (elements.length === 0)
    return (
      <p className="text-sm text-neutral-500">
        Nothing on the label yet. Use Add on the left to start.
      </p>
    );

  return (
    <ul
      className="max-h-56 divide-y divide-neutral-200 overflow-auto rounded border border-neutral-200 text-sm"
      aria-label="Layers"
    >
      {topFirst.map((el, i) => {
        const Icon = kindIcon(el);
        const selected = selectedIds.includes(el.id);
        const title = elementTitle(el);
        return (
          <li
            key={el.id}
            className={`flex items-center gap-1 px-1.5 py-1 ${
              selected ? "bg-sky-100" : "hover:bg-neutral-100"
            } ${el.hidden ? "opacity-50" : ""}`}
          >
            <Icon size={14} className="shrink-0 text-neutral-500" aria-hidden />
            {renaming === el.id ? (
              <input
                autoFocus
                className="min-w-0 flex-1 rounded border border-neutral-300 px-1 text-sm"
                defaultValue={el.kind === "icon" ? el.name : (el.name ?? "")}
                placeholder={title}
                maxLength={60}
                aria-label={`Rename ${title}`}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  // Icons always keep a name; others fall back to a description.
                  if (el.kind !== "icon")
                    onPatch(el.id, { name: v || undefined });
                  else if (v) onPatch(el.id, { name: v });
                  setRenaming(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(undefined);
                }}
              />
            ) : (
              <button
                type="button"
                className="min-w-0 flex-1 truncate px-1 text-left"
                title="Click to select · double-click to rename"
                aria-pressed={selected}
                onClick={(e) =>
                  onSelect(el.id, e.shiftKey || e.ctrlKey || e.metaKey)
                }
                onDoubleClick={() => setRenaming(el.id)}
              >
                {title}
              </button>
            )}
            <button
              type="button"
              className={rowButton}
              aria-label={`Move ${title} up`}
              title="Move up (in front)"
              disabled={i === 0}
              onClick={() => onReorder(el.id, "up")}
            >
              <ChevronUp size={14} aria-hidden />
            </button>
            <button
              type="button"
              className={rowButton}
              aria-label={`Move ${title} down`}
              title="Move down (behind)"
              disabled={i === topFirst.length - 1}
              onClick={() => onReorder(el.id, "down")}
            >
              <ChevronDown size={14} aria-hidden />
            </button>
            <button
              type="button"
              className={rowButton}
              aria-label={el.hidden ? `Show ${title}` : `Hide ${title}`}
              aria-pressed={!!el.hidden}
              title={el.hidden ? "Hidden (not printed). Click to show" : "Hide"}
              onClick={() =>
                onPatch(el.id, { hidden: el.hidden ? undefined : true })
              }
            >
              {el.hidden ? (
                <EyeOff size={14} aria-hidden />
              ) : (
                <Eye size={14} aria-hidden />
              )}
            </button>
            <button
              type="button"
              className={rowButton}
              aria-label={el.locked ? `Unlock ${title}` : `Lock ${title}`}
              aria-pressed={!!el.locked}
              title={
                el.locked ? "Locked on the canvas. Click to unlock" : "Lock"
              }
              onClick={() =>
                onPatch(el.id, { locked: el.locked ? undefined : true })
              }
            >
              {el.locked ? (
                <Lock size={14} aria-hidden />
              ) : (
                <Unlock size={14} aria-hidden />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
