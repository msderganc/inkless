"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type LabelOverride } from "~/lib/catalogue";
import {
  B21SerialClient,
  browserPortSource,
  NIIMBOT_USB_VENDOR_ID,
} from "~/lib/printer/serial-client";
import {
  PrinterSession,
  type SessionStatus,
  webLockProvider,
} from "~/lib/printer/session";
import {
  DEFAULT_SETTINGS,
  type Draft,
  type Settings,
  Store,
} from "~/lib/store/store";

interface AppContextValue {
  store: Store;
  session: PrinterSession;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  overrides: Record<string, LabelOverride>;
  reloadOverrides: () => Promise<void>;
  /** Editor working state saved before the last refresh, if any. */
  initialDraft?: Draft;
  /** User-initiated connect: remembers the printer for automatic reconnects. */
  connectPrinter: () => Promise<void>;
  /** User-initiated disconnect: stops automatic reconnects until the next connect. */
  disconnectPrinter: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

/** One printer session per page; created lazily in the browser only. */
let sharedSession: PrinterSession | undefined;
function getSession(): PrinterSession {
  sharedSession ??= new PrinterSession({
    // Automatic reconnects have no user gesture, so they may only reuse a remembered port.
    createClient: ({ auto }) =>
      new B21SerialClient(browserPortSource({ allowPrompt: !auto })),
    lock: webLockProvider(),
  });
  return sharedSession;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<Store>();
  const [error, setError] = useState<string>();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const [overrides, setOverrides] = useState<Record<string, LabelOverride>>({});
  const [initialDraft, setInitialDraft] = useState<Draft>();
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
        settingsRef.current = loaded;
        setSettings(loaded);
        setOverrides(await s.getOverrides());
        setInitialDraft(await s.getDraft());
        setStore(s);
        // Reconnect to the printer used last time (silently; no port picker).
        if (loaded.autoConnect) void session.connect({ auto: true });
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [session]);

  // Lifecycle (spec Phase 5): poll only while visible, and release the printer when the page goes away.
  useEffect(() => {
    const onVisibility = () =>
      session.setVisible(document.visibilityState === "visible");
    const onPageHide = () => void session.disconnect();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [session]);

  // Printer plugged back in (or switched on): reconnect if the user was connected before.
  useEffect(() => {
    if (!("serial" in navigator)) return;
    const onConnect = (e: Event) => {
      const port = (e.target ?? undefined) as SerialPort | undefined;
      if (port && port.getInfo().usbVendorId !== NIIMBOT_USB_VENDOR_ID) return;
      const state = session.getStatus().state;
      if (
        settingsRef.current.autoConnect &&
        (state === "disconnected" || state === "error")
      ) {
        // Give the device a moment to finish enumerating before opening it.
        setTimeout(() => void session.connect({ auto: true }), 1_000);
      }
    };
    navigator.serial.addEventListener("connect", onConnect);
    return () => navigator.serial.removeEventListener("connect", onConnect);
  }, [session]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      if (!store) return;
      // Read the latest settings, not a render-time copy, so close-together updates don't clobber.
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      session.setPacketLogging(next.diagnostics);
      await store.saveSettings(next);
    },
    [store, session],
  );

  const connectPrinter = useCallback(async () => {
    await session.connect();
    if (
      session.getStatus().state === "ready" &&
      !settingsRef.current.autoConnect
    ) {
      await updateSettings({ autoConnect: true });
    }
  }, [session, updateSettings]);

  const disconnectPrinter = useCallback(async () => {
    await updateSettings({ autoConnect: false });
    await session.disconnect();
  }, [session, updateSettings]);

  const reloadOverrides = useCallback(async () => {
    if (store) setOverrides(await store.getOverrides());
  }, [store]);

  if (error) {
    return (
      <div className="p-6 text-red-700">
        Local storage is unavailable ({error}). Templates cannot be saved in
        this browser profile.
      </div>
    );
  }
  if (!store) return <div className="p-6 text-neutral-500">Loading…</div>;

  return (
    <AppContext.Provider
      value={{
        store,
        session,
        settings,
        updateSettings,
        overrides,
        reloadOverrides,
        initialDraft,
        connectPrinter,
        disconnectPrinter,
      }}
    >
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
