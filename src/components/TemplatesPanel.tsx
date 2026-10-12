"use client";

import { CopyPlus, Download, Save, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Template } from "~/lib/store/store";
import { useApp } from "./app-context";
import { IconButton } from "./IconButton";

interface Props {
  current?: { id: string; name: string };
  onSave: (name: string, asNew: boolean) => Promise<void>;
  onLoad: (t: Template) => void;
  onDeleted: (id: string) => void;
  revision: number;
}

export function TemplatesPanel({
  current,
  onSave,
  onLoad,
  onDeleted,
  revision,
}: Props) {
  const { store, reloadOverrides } = useApp();
  const [items, setItems] = useState<Template[]>([]);
  const [name, setName] = useState(current?.name ?? "");
  const [message, setMessage] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(
    async () => setItems(await store.listTemplates()),
    [store],
  );
  useEffect(() => void refresh(), [refresh, revision]);
  useEffect(() => setName(current?.name ?? ""), [current]);

  const save = async (asNew: boolean) => {
    const n = name.trim();
    if (!n) {
      setMessage("Enter a name first.");
      return;
    }
    await onSave(n, asNew);
    setMessage(`Saved “${n}”.`);
    await refresh();
  };

  const exportBackup = async () => {
    const backup = await store.exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `label-templates-${backup.exportedAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const importBackup = async (file: File) => {
    try {
      const result = await store.importBackup(JSON.parse(await file.text()));
      await reloadOverrides();
      await refresh();
      setMessage(`Imported ${result.templates} template(s).`);
    } catch {
      setMessage("That file is not a valid label backup. Nothing was changed.");
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        Templates
      </h2>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          placeholder="Template name"
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <IconButton
          icon={Save}
          label={current ? `Save "${current.name}"` : "Save template"}
          onClick={() => void save(false)}
        />
        {current && (
          <IconButton
            icon={CopyPlus}
            label="Save as new template"
            onClick={() => void save(true)}
          />
        )}
      </div>
      {message && (
        <p className="text-xs text-neutral-600" role="status">
          {message}
        </p>
      )}

      <ul className="max-h-64 divide-y overflow-auto rounded border border-neutral-200 text-sm">
        {items.length === 0 && (
          <li className="p-2 text-neutral-500">No saved templates yet.</li>
        )}
        {items.map((t) => (
          <li
            key={t.id}
            className={`flex items-center gap-2 p-2 ${t.id === current?.id ? "bg-sky-50" : ""}`}
          >
            <button
              type="button"
              className="flex-1 truncate text-left hover:underline"
              onClick={() => onLoad(t)}
            >
              {t.name}
            </button>
            <IconButton
              icon={Trash2}
              label={`Delete template "${t.name}"`}
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!window.confirm(`Delete template "${t.name}"?`)) return;
                await store.deleteTemplate(t.id);
                onDeleted(t.id);
                await refresh();
              }}
            />
          </li>
        ))}
      </ul>

      <div className="flex gap-2 text-sm">
        <IconButton
          icon={Download}
          label="Export backup (all templates)"
          onClick={() => void exportBackup()}
        />
        <IconButton
          icon={Upload}
          label="Import backup"
          onClick={() => fileInput.current?.click()}
        />
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
    </section>
  );
}
