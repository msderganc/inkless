import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { ServiceWorker } from "~/components/ServiceWorker";

export const metadata: Metadata = {
  title: "B21S Labels",
  description: "Offline label designer and printer for the NIIMBOT B21S",
  manifest: "/manifest.webmanifest",
  icons: [
    { rel: "icon", url: "/icon.svg", type: "image/svg+xml" },
    { rel: "icon", url: "/favicon.ico" },
  ],
};

export const viewport: Viewport = { themeColor: "#0284c7" };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
