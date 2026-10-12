"use client";

import dynamic from "next/dynamic";
import { AppProvider } from "~/components/app-context";
import { LoadingStep } from "~/components/LoadingStep";

const OAuthCallback = dynamic(() => import("~/components/OAuthCallback"), {
  ssr: false,
  loading: () => <LoadingStep step="Finishing ChatGPT sign-in" />,
});

export default function OAuthCallbackPage() {
  return (
    <AppProvider>
      <OAuthCallback />
    </AppProvider>
  );
}
