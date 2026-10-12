"use client";

import dynamic from "next/dynamic";
import { AppProvider } from "~/components/app-context";
import { LoadingStep } from "~/components/LoadingStep";

// Browser-only: Web Serial, canvas and IndexedDB do not exist during static pre-rendering.
const Editor = dynamic(() => import("~/components/Editor"), {
  ssr: false,
  loading: () => (
    <LoadingStep
      step="Loading the editor code"
      hint="The app files may not have downloaded. Reload; if it persists, the service worker cache may be stale."
    />
  ),
});

export default function HomePage() {
  return (
    <AppProvider>
      <Editor />
    </AppProvider>
  );
}
