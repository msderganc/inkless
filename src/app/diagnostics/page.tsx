"use client";

import dynamic from "next/dynamic";
import { AppProvider } from "~/components/app-context";
import { LoadingStep } from "~/components/LoadingStep";

const Diagnostics = dynamic(() => import("~/components/Diagnostics"), {
  ssr: false,
  loading: () => (
    <LoadingStep
      step="Loading the editor code"
      hint="The app files may not have downloaded. Reload; if it persists, the service worker cache may be stale."
    />
  ),
});

export default function DiagnosticsPage() {
  return (
    <AppProvider>
      <Diagnostics />
    </AppProvider>
  );
}
