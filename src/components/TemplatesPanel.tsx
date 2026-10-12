"use client";

import { Download, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Template } from "~/lib/store/store";
import { useApp } from "./app-context";

interface Props {
  current?: { id: string; name: string };
  onLoad: (t: Template) => void;
  onDeleted: (id: string) => void;
  /** Bumped after a save so the list refreshes. */
  revision: number;
}

/** Saved labels (templates): open, delete, and back up everything to a file. */
export function TemplatesPanel({
  current,
  onLoad,
  onDeleted,
  revision,
}: Props) {
  const { store, reloadOverrides } = useApp();
  const [items, setItems] = useState<Template[]>([]);
  const [message, setMessage] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(
    async () => setItems(await store.listTemplates()),
    [store],
  );
  useEffect(() => void refresh(), [refresh, revision]);

  const exportBackup = async () => {
    const backup = await store.exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `label-backup-${backup.exportedAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setMessage("Backup downloaded (saved labels, settings and My icons).");
  };

  const importBackup = async (file: File) => {
    try {
      const result = await store.importBackup(JSON.parse(await file.text()));
      await reloadOverrides();
      await refresh();
      setMessage(`Imported ${result.templates} saved label(s).`);
    } catch {
      setMessage("That file is not a valid label backup. Nothing was changed.");
    }
  };

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        Saved labels
      </h2>
      <ul className="max-h-64 overflow-auto rounded border border-neutral-200 text-sm">
        {items.length === 0 && (
          <li className="p-2 text-neutral-500">
            Nothing saved yet. Name your label above the canvas and press Save.
          </li>
        )}
        {items.map((t) => {
          const open = t.id === current?.id;
          return (
            <li
              key={t.id}
              className={`flex items-center gap-2 border-l-4 py-1.5 pr-1.5 pl-2 ${
                open
                  ? "border-sky-600 bg-sky-50"
                  : "border-transparent hover:bg-neutral-100"
              }`}
            >
              <button
                type="button"
                className={`flex-1 truncate text-left ${open ? "font-semibold" : ""}`}
                aria-current={open ? "true" : undefined}
                title={open ? "Open now" : `Open "${t.name}"`}
                onClick={() => onLoad(t)}
              >
                {t.name}
              </button>
              {open && (
                <span className="text-on-accent rounded bg-sky-600 px-1.5 text-[10px] font-medium">
                  OPEN
                </span>
              )}
              <button
                type="button"
                className="rounded p-1 text-red-700 hover:bg-red-50"
                aria-label={`Delete saved label "${t.name}"`}
                title="Delete"
                onClick={async () => {
                  if (!window.confirm(`Delete saved label "${t.name}"?`))
                    return;
                  await store.deleteTemplate(t.id);
                  onDeleted(t.id);
                  await refresh();
                }}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex gap-2 text-xs">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
          title="Download every saved label, your settings and My icons as one file"
          onClick={() => void exportBackup()}
        >
          <Download size={14} aria-hidden />
          Export backup
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
          title="Restore from a backup file (adds to what's here)"
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={14} aria-hidden />
          Import backup
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importBackup(f);
          }}
        />
      </div>
      {message && (
        <p className="text-xs text-neutral-600" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
