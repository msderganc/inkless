"use client";

import {
  BookmarkCheck,
  Circle,
  Frame,
  ImagePlus,
  type LucideIcon,
  Minus,
  Shapes,
  Sparkles,
  Spline,
  Square,
  Type,
} from "lucide-react";

export type AddTool =
  | "text"
  | "curved"
  | "image"
  | "library"
  | "my-icons"
  | "ai"
  | "rect"
  | "ellipse"
  | "line"
  | "frame";

const TOOLS: { id: AddTool; icon: LucideIcon; label: string; hint: string }[] =
  [
    { id: "text", icon: Type, label: "Text", hint: "Add a text box" },
    {
      id: "curved",
      icon: Spline,
      label: "Curved text",
      hint: "Text on an arc",
    },
    {
      id: "image",
      icon: ImagePlus,
      label: "Image",
      hint: "Add a picture file",
    },
    {
      id: "library",
      icon: Shapes,
      label: "Icons",
      hint: "Offline icon library",
    },
    {
      id: "my-icons",
      icon: BookmarkCheck,
      label: "My icons",
      hint: "Icons you saved",
    },
    {
      id: "ai",
      icon: Sparkles,
      label: "AI icon",
      hint: "Generate an icon with AI",
    },
    { id: "rect", icon: Square, label: "Rectangle", hint: "Add a rectangle" },
    {
      id: "ellipse",
      icon: Circle,
      label: "Ellipse",
      hint: "Add a circle or ellipse",
    },
    { id: "line", icon: Minus, label: "Line", hint: "Add a line" },
    {
      id: "frame",
      icon: Frame,
      label: "Border",
      hint: "A border that follows the label shape",
    },
  ];

/** Labelled buttons for everything that can be added to a label. */
export function AddTools({ onAdd }: { onAdd: (tool: AddTool) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.hint}
          className="flex items-center gap-2 rounded border border-neutral-300 bg-white px-2 py-1.5 text-left text-sm text-neutral-800 hover:border-sky-500 hover:bg-sky-50"
          onClick={() => onAdd(t.id)}
        >
          <t.icon size={16} aria-hidden className="shrink-0" />
          <span className="truncate">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
