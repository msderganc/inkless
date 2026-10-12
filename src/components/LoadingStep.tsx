"use client";

import { useEffect, useState } from "react";

/**
 * Loading placeholder that names the step, and after a few seconds explains that it is stuck
 * with what to try, so a hang can be diagnosed instead of showing "Loading…" forever.
 */
export function LoadingStep({ step, hint }: { step: string; hint?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4_000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="space-y-2 p-6 text-neutral-500" role="status">
      <p>{step}…</p>
      {slow && (
        <div className="max-w-lg space-y-2 text-sm text-neutral-700">
          <p>
            This is taking longer than it should (stuck at:{" "}
            <strong>{step}</strong>).
          </p>
          {hint && <p>{hint}</p>}
          <button
            type="button"
            className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
