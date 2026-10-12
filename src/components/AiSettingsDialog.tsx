"use client";

import { Eye, EyeOff, LogIn, LogOut, Save } from "lucide-react";
import {
  buildAuthorizeUrl,
  CALLBACK_PORT,
  type ChatgptAuth,
  isSignedIn,
  newPendingSignIn,
  signOut,
} from "~/lib/ai/chatgpt-auth";
import { useEffect, useState } from "react";
import {
  type AiProvider,
  MODEL_SUGGESTIONS,
  OPENAI_IMAGE_MODELS,
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
      openaiImageModel:
        value.openaiImageModel.trim() || DEFAULT_AI_SETTINGS.openaiImageModel,
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

          {p === "openai" && (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-xs text-neutral-600">
                Pay with
              </legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="openaiAuth"
                  checked={value.openaiAuth === "key"}
                  onChange={() => set({ openaiAuth: "key" })}
                />
                API key (billed to your OpenAI API account)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="openaiAuth"
                  checked={value.openaiAuth === "chatgpt"}
                  onChange={() =>
                    set({ openaiAuth: "chatgpt", iconStyle: "vector" })
                  }
                />
                My ChatGPT plan (Sign in with ChatGPT)
              </label>
            </fieldset>
          )}

          {p === "openai" && value.openaiAuth === "chatgpt" ? (
            <ChatgptSignIn onSignedOut={() => setSaved(undefined)} />
          ) : (
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
          )}

          {p === "openai" && value.openaiAuth === "key" && (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-xs text-neutral-600">
                Icon style
              </legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="style"
                  checked={value.iconStyle === "vector"}
                  onChange={() => set({ iconStyle: "vector" })}
                />
                <span>
                  Vector (text model draws SVG)
                  <span className="block text-xs text-neutral-500">
                    Crispest print, bold simple shapes. Recommended.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="style"
                  checked={value.iconStyle === "image"}
                  onChange={() => set({ iconStyle: "image" })}
                />
                <span>
                  Image model (GPT Image)
                  <span className="block text-xs text-neutral-500">
                    More detailed illustrations, converted to black and white.
                    Fine detail may break up at small sizes.
                  </span>
                </span>
              </label>
            </fieldset>
          )}

          {p === "openai" &&
          value.openaiAuth === "key" &&
          value.iconStyle === "image" ? (
            <ModelPicker
              key={`${p}-${value.iconStyle}`}
              label="Image model"
              options={OPENAI_IMAGE_MODELS}
              value={value.openaiImageModel}
              onChange={(openaiImageModel) => set({ openaiImageModel })}
            />
          ) : (
            <ModelPicker
              key={`${p}-${value.iconStyle}`}
              label="Model"
              options={MODEL_SUGGESTIONS[p]}
              value={value[modelField]}
              onChange={(m) => set({ [modelField]: m })}
            />
          )}

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

const CUSTOM = "__custom__";

/** Dropdown of known models (all always visible) with a "Custom…" option for any other id. */
function ModelPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (model: string) => void;
}) {
  const known = options.includes(value);
  const [custom, setCustom] = useState(!known);
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-600">{label}</span>
        <select
          className="rounded border border-neutral-300 px-2 py-1 font-mono"
          value={custom ? CUSTOM : value}
          onChange={(e) => {
            if (e.target.value === CUSTOM) setCustom(true);
            else {
              setCustom(false);
              onChange(e.target.value);
            }
          }}
        >
          {options.map((m, i) => (
            <option key={m} value={m}>
              {m}
              {i === 0 ? "  (recommended)" : ""}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </label>
      {custom && (
        <input
          aria-label={`${label} id`}
          className="rounded border border-neutral-300 px-2 py-1 font-mono"
          placeholder="model id, e.g. gpt-6.1-sol"
          maxLength={100}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/** "Sign in with ChatGPT" status and buttons. */
function ChatgptSignIn({ onSignedOut }: { onSignedOut: () => void }) {
  const { store } = useApp();
  const [auth, setAuth] = useState<ChatgptAuth>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void store.getChatgptAuth().then(setAuth);
  }, [store]);

  const signIn = async () => {
    setError(undefined);
    setBusy(true);
    try {
      // OpenAI only redirects to 127.0.0.1, where the app's local server forwards the code.
      const ok = await fetch(`http://127.0.0.1:${CALLBACK_PORT}/health`, {
        cache: "no-store",
      })
        .then((r) => r.ok)
        .catch(() => false);
      if (!ok) {
        setError(
          "Start the local server first (npm run serve), then try again. It's only needed while signing in.",
        );
        return;
      }
      const current = auth ?? (await store.getChatgptAuth());
      const pending = newPendingSignIn();
      await store.savePendingSignIn(pending);
      window.location.assign(await buildAuthorizeUrl(current, pending));
    } finally {
      setBusy(false);
    }
  };

  const doSignOut = async () => {
    if (!auth) return;
    const cleared = await signOut(auth);
    await store.saveChatgptAuth(cleared);
    setAuth(cleared);
    onSignedOut();
  };

  const signedIn = isSignedIn(auth);
  return (
    <div className="space-y-2 rounded border border-neutral-200 p-2">
      {signedIn ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-emerald-700">
            Signed in{auth?.email ? ` as ${auth.email}` : ""}. Icons use your
            ChatGPT plan.
          </span>
          <IconButton
            icon={LogOut}
            label="Sign out of ChatGPT"
            size="sm"
            onClick={() => void doSignOut()}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="flex-1">Not signed in.</span>
          <IconButton
            icon={LogIn}
            label="Sign in with ChatGPT"
            variant="primary"
            disabled={busy}
            onClick={() => void signIn()}
          />
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
      <p className="text-xs text-neutral-500">
        Uses your Plus/Pro allowance (vector icons only; image models
        aren&apos;t available this way). Set a per-app limit or disconnect in
        ChatGPT → Settings → Security.
      </p>
    </div>
  );
}
