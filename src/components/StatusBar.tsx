"use client";

import Link from "next/link";
import { type SessionState } from "~/lib/printer/session";
import { useApp, useSessionStatus } from "./app-context";

const STATE_TEXT: Record<SessionState, string> = {
  disconnected: "Not connected",
  connecting: "Connecting…",
  ready: "Ready",
  printing: "Printing…",
  cancelling: "Cancelling after this label…",
  error: "Problem",
};

const STATE_DOT: Record<SessionState, string> = {
  disconnected: "bg-neutral-400",
  connecting: "bg-amber-400 animate-pulse",
  ready: "bg-emerald-500",
  printing: "bg-sky-500 animate-pulse",
  cancelling: "bg-amber-500 animate-pulse",
  error: "bg-red-500",
};

export function StatusBar({ page }: { page: "editor" | "diagnostics" }) {
  const { session, connectPrinter, disconnectPrinter } = useApp();
  const status = useSessionStatus(session);
  const { state, identity, heartbeat, error, progress } = status;
  const connected =
    state === "ready" || state === "printing" || state === "cancelling";

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 bg-white px-4 py-2 text-sm">
      <span className="font-semibold">B21S Labels</span>
      <span
        className="flex items-center gap-2"
        role="status"
        aria-live="polite"
      >
        <span
          className={`inline-block size-2.5 rounded-full ${STATE_DOT[state]}`}
          aria-hidden
        />
        {STATE_TEXT[state]}
        {progress && (state === "printing" || state === "cancelling") && (
          <span className="text-neutral-500">
            {progress.done} / {progress.total}
          </span>
        )}
      </span>
      {identity && connected && (
        <span className="text-neutral-500">
          {identity.model} · fw {identity.firmware ?? "?"}
        </span>
      )}
      {heartbeat && connected && (
        <span className="text-neutral-500">
          {heartbeat.lidClosed === false ? "Lid open · " : ""}
          {heartbeat.paperInserted === false ? "No labels · " : ""}
          {heartbeat.paperRfidSuccess === false ? "Roll not recognised" : ""}
        </span>
      )}
      {error && <span className="text-red-700">{error}</span>}
      <span className="ml-auto flex items-center gap-3">
        <Link
          className="text-sky-700 underline-offset-2 hover:underline"
          href={page === "editor" ? "/diagnostics/" : "/"}
        >
          {page === "editor" ? "Diagnostics" : "Editor"}
        </Link>
        {connected ? (
          <button
            type="button"
            className="rounded border border-neutral-300 px-3 py-1 hover:bg-neutral-100 disabled:opacity-50"
            onClick={() => void disconnectPrinter()}
            disabled={state !== "ready"}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            onClick={() => void connectPrinter()}
            disabled={state === "connecting"}
          >
            Connect printer
          </button>
        )}
      </span>
    </header>
  );
}
