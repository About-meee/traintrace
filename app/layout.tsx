import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "练迹 · TRAINTRACE",
  description: "个人训练记录",
  icons: {
    icon: [
      { url: "/assets/favicon.ico", sizes: "16x16 32x32" },
      { url: "/assets/traintrace-icon-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: [
      { url: "/assets/traintrace-apple-touch-180.png", sizes: "180x180" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1720",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          rel="manifest"
          href="/manifest.webmanifest"
          crossOrigin="use-credentials"
        />
        <link
          rel="stylesheet"
          href="/styles.css"
          crossOrigin="use-credentials"
        />
        <link
          rel="stylesheet"
          href="/reference-finish.css"
          crossOrigin="use-credentials"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
