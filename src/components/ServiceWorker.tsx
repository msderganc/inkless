"use client";

import { useEffect, useState } from "react";

/** Registers the offline service worker (production builds only) and offers updates. */
export function ServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let reloading = false;
    // First install: clients.claim() also fires controllerchange; reloading then would discard work.
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
        });
      });
    });
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting) return null;
  return (
    <div className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg" role="status">
      A new version is ready.
      <button type="button" className="rounded bg-sky-500 px-2 py-1 font-medium" onClick={() => waiting.postMessage("skipWaiting")}>
        Update
      </button>
    </div>
  );
}
