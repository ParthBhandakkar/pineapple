import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "@/app/globals.css";
import { ThemeRoot } from "@/components/ThemeRoot";
import { ToastProvider } from "@/components/ui/Toast";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "PineApple | OpenCode Agent Platform",
  description: "A secure OpenCode and OpenRouter powered agent SaaS platform.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={plusJakarta.variable}>
      <body className={plusJakarta.className} suppressHydrationWarning>
        <ThemeRoot>
          <ToastProvider>{children}</ToastProvider>
        </ThemeRoot>
      </body>
    </html>
  );
}
