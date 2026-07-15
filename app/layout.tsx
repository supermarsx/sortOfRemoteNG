import type { Metadata } from "next";
import "./globals.css";

// eslint-disable-next-line react-refresh/only-export-components
export const metadata: Metadata = {
  title: "sortOfRemoteNG",
  description: "A remote management tool",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
