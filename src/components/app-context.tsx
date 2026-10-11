"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { type LabelOverride } from "~/lib/catalogue";
import { B21SerialClient, browserPortSource } from "~/lib/printer/serial-client";
import { PrinterSession, type SessionStatus, webLockProvider } from "~/lib/printer/session";
import { DEFAULT_SETTINGS, type Settings, Store } from "~/lib/store/store";

interface AppContextValue {
  store: Store;
  session: PrinterSession;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  overrides: Record<string, LabelOverride>;
  reloadOverrides: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

/** One printer session per page; created lazily in the browser only. */
let sharedSession: PrinterSession | undefined;
function getSession(): PrinterSession {
  sharedSession ??= new PrinterSession({
    createClient: () => new B21SerialClient(browserPortSource()),
    lock: webLockProvider(),
  });
  return sharedSession;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<Store>();
  const [error, setError] = useState<string>();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [overrides, setOverrides] = useState<Record<string, LabelOverride>>({});
  const session = useMemo(getSession, []);

  useEffect(() => {
    let opened: Store | undefined;
    let cancelled = false;
    Store.open()
      .then(async (s) => {
        if (cancelled) return s.close();
        opened = s;
        const loaded = await s.getSettings();
        session.setPacketLogging(loaded.diagnostics);
        setSettings(loaded);
        setOverrides(await s.getOverrides());
        setStore(s);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [session]);

  // Lifecycle (spec Phase 5): poll only while visible, and release the printer when the page goes away.
  useEffect(() => {
    const onVisibility = () => session.setVisible(document.visibilityState === "visible");
    const onPageHide = () => void session.disconnect();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [session]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      if (!store) return;
      const next = { ...settings, ...patch };
      await store.saveSettings(next);
      setSettings(next);
      session.setPacketLogging(next.diagnostics);
    },
    [store, settings, session],
  );

  const reloadOverrides = useCallback(async () => {
    if (store) setOverrides(await store.getOverrides());
  }, [store]);

  if (error) {
    return (
      <div className="p-6 text-red-700">
        Local storage is unavailable ({error}). Templates cannot be saved in this browser profile.
      </div>
    );
  }
  if (!store) return <div className="p-6 text-neutral-500">Loading…</div>;

  return (
    <AppContext.Provider value={{ store, session, settings, updateSettings, overrides, reloadOverrides }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export function useSessionStatus(session: PrinterSession): SessionStatus {
  return useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.getStatus(),
    () => session.getStatus(),
  );
}
