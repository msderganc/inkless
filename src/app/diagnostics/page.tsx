"use client";

import dynamic from "next/dynamic";
import { AppProvider } from "~/components/app-context";

const Diagnostics = dynamic(() => import("~/components/Diagnostics"), {
  ssr: false,
  loading: () => <div className="p-6 text-neutral-500">Loading…</div>,
});

export default function DiagnosticsPage() {
  return (
    <AppProvider>
      <Diagnostics />
    </AppProvider>
  );
}
