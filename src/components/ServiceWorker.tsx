"use client";

import { useEffect } from "react";
import { flushPendingWork } from "~/lib/flush";
import { isPrinterBusy } from "./app-context";

const UPDATE_CHECK_MS = 30 * 60_000;

/**
 * Registers the offline service worker (production builds only) and applies updates by itself:
 * a new build activates as soon as it is cached, and the page reloads when no print is running.
 * Pending work is saved first (flushPendingWork), so the reload loses nothing.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;
    let reloading = false;
    let retry: ReturnType<typeof setInterval> | undefined;
    // First install: clients.claim() also fires controllerchange; reloading then is pointless.
    const hadController = !!navigator.serviceWorker.controller;
    const reloadWhenIdle = () => {
      if (reloading) return;
      if (!isPrinterBusy()) {
        reloading = true;
        // Save the editor's latest changes first; the autosave may still be waiting.
        void flushPendingWork().finally(() => window.location.reload());
        return;
      }
      // Never interrupt a print: try again until the job has finished.
      retry ??= setInterval(reloadWhenIdle, 2_000);
    };
    const onControllerChange = () => {
      if (hadController) reloadWhenIdle();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    let registration: ServiceWorkerRegistration | undefined;
    void navigator.serviceWorker.register("/sw.js").then((reg) => {
      registration = reg;
      // A build left waiting by an older version of this page: activate it now.
      reg.waiting?.postMessage("skipWaiting");
    });
    // Long-open windows still pick up new builds.
    const check = () => void registration?.update().catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, UPDATE_CHECK_MS);

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
      if (retry) clearInterval(retry);
    };
  }, []);

  return null;
}
