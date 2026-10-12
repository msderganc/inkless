"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { completeSignIn } from "~/lib/ai/chatgpt-auth";
import { useApp } from "./app-context";

/** Finishes "Sign in with ChatGPT": verifies state, exchanges the code (PKCE), saves tokens. */
export default function OAuthCallback() {
  const { store } = useApp();
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // the code is single-use
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    // Remove the code from the address bar and history straight away.
    window.history.replaceState(null, "", "/oauth-callback/");
    void (async () => {
      const pending = await store.getPendingSignIn();
      await store.savePendingSignIn(undefined);
      try {
        const auth = await store.getChatgptAuth();
        const next = await completeSignIn(auth, pending, {
          code: params.get("code"),
          state: params.get("state"),
          error: params.get("error"),
        });
        await store.saveChatgptAuth(next);
        const ai = await store.getAiSettings();
        await store.saveAiSettings({
          ...ai,
          provider: "openai",
          openaiAuth: "chatgpt",
          iconStyle: "vector",
        });
        setStatus({
          ok: true,
          text: `Signed in${next.email ? ` as ${next.email}` : ""}. AI icons will use your ChatGPT plan.`,
        });
        setTimeout(() => window.location.replace("/"), 1500);
      } catch (e) {
        setStatus({
          ok: false,
          text: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [store]);

  return (
    <main className="mx-auto max-w-md space-y-3 p-8 text-neutral-900">
      <h1 className="text-lg font-semibold">Sign in with ChatGPT</h1>
      {!status && <p role="status">Finishing sign-in…</p>}
      {status && (
        <p
          role={status.ok ? "status" : "alert"}
          className={status.ok ? "text-emerald-700" : "text-red-700"}
        >
          {status.text}
        </p>
      )}
      <Link href="/" className="text-sky-700 underline">
        Back to the editor
      </Link>
    </main>
  );
}
