"use client";

import dynamic from "next/dynamic";
import { AppProvider } from "~/components/app-context";

// Browser-only: Web Serial, canvas and IndexedDB do not exist during static pre-rendering.
const Editor = dynamic(() => import("~/components/Editor"), {
  ssr: false,
  loading: () => <div className="p-6 text-neutral-500">Loading…</div>,
});

export default function HomePage() {
  return (
    <AppProvider>
      <Editor />
    </AppProvider>
  );
}
