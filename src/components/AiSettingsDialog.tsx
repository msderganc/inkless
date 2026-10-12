"use client";

import { Eye, EyeOff, Save } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type AiProvider,
  MODEL_SUGGESTIONS,
  PROVIDER_NAMES,
} from "~/lib/ai/models";
import { type AiSettings, DEFAULT_AI_SETTINGS } from "~/lib/store/store";
import { useApp } from "./app-context";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

const KEY_LINKS: Record<AiProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
};

/** AI provider, API keys and models. Keys stay in this browser and are never exported. */
export function AiSettingsDialog({ onClose }: { onClose: () => void }) {
  const { store } = useApp();
  const [value, setValue] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState<string>();

  useEffect(() => {
    void store.getAiSettings().then((v) => {
      setValue(v);
      setLoaded(true);
    });
  }, [store]);

  const set = (patch: Partial<AiSettings>) => {
    setValue((v) => ({ ...v, ...patch }));
    setSaved(undefined);
  };
  const save = async () => {
    await store.saveAiSettings({
      ...value,
      anthropicKey: value.anthropicKey.trim(),
      openaiKey: value.openaiKey.trim(),
      anthropicModel:
        value.anthropicModel.trim() || DEFAULT_AI_SETTINGS.anthropicModel,
      openaiModel: value.openaiModel.trim() || DEFAULT_AI_SETTINGS.openaiModel,
    });
    setSaved("Saved.");
  };

  const p = value.provider;
  const keyField = p === "anthropic" ? "anthropicKey" : "openaiKey";
  const modelField = p === "anthropic" ? "anthropicModel" : "openaiModel";

  return (
    <Modal title="AI icon settings" onClose={onClose}>
      {!loaded ? (
        <p className="text-neutral-500">Loading…</p>
      ) : (
        <form
          className="space-y-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs text-neutral-600">Provider</legend>
            {(["anthropic", "openai"] as const).map((prov) => (
              <label key={prov} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="provider"
                  checked={p === prov}
                  onChange={() => set({ provider: prov })}
                />
                {PROVIDER_NAMES[prov]}
                {(prov === "anthropic"
                  ? value.anthropicKey
                  : value.openaiKey) && (
                  <span className="text-xs text-emerald-600">key saved</span>
                )}
              </label>
            ))}
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-600">
              {PROVIDER_NAMES[p]} API key ·{" "}
              <a
                className="text-sky-700 underline"
                href={KEY_LINKS[p]}
                target="_blank"
                rel="noreferrer"
              >
                get a key
              </a>
            </span>
            <span className="flex gap-1">
              <input
                className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 font-mono"
                type={show ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={value[keyField]}
                placeholder={p === "anthropic" ? "sk-ant-…" : "sk-…"}
                onChange={(e) => set({ [keyField]: e.target.value })}
              />
              <IconButton
                icon={show ? EyeOff : Eye}
                label={show ? "Hide key" : "Show key"}
                onClick={() => setShow(!show)}
              />
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-600">Model</span>
            <input
              className="rounded border border-neutral-300 px-2 py-1 font-mono"
              list={`models-${p}`}
              value={value[modelField]}
              onChange={(e) => set({ [modelField]: e.target.value })}
            />
            <datalist id={`models-${p}`}>
              {MODEL_SUGGESTIONS[p].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>

          <p className="rounded bg-neutral-50 p-2 text-xs text-neutral-600">
            Keys are stored only in this browser and sent only to the provider
            you pick, when you generate an icon. They are not included in
            backups. Each generation is billed to your account.
          </p>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="hidden"
              aria-hidden
              tabIndex={-1}
            />
            <IconButton
              icon={Save}
              label="Save AI settings"
              variant="primary"
              onClick={() => void save()}
            />
            {saved && <span role="status">{saved}</span>}
          </div>
        </form>
      )}
    </Modal>
  );
}
