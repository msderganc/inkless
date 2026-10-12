import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { ServiceWorker } from "~/components/ServiceWorker";
import { THEME_BOOT_SCRIPT } from "~/lib/theme";

export const metadata: Metadata = {
  title: "B21S Labels",
  description: "Offline label designer and printer for the NIIMBOT B21S",
  manifest: "/manifest.webmanifest",
  icons: [
    { rel: "icon", url: "/icon.svg", type: "image/svg+xml" },
    { rel: "icon", url: "/favicon.ico" },
  ],
};

export const viewport: Viewport = {
  themeColor: "#0284c7",
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the boot script may add the "dark" class before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="bg-neutral-100 font-sans text-neutral-900 antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
