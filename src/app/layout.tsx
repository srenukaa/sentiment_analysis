import type { Metadata } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz", "SOFT"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sentira — Real-time Sentiment Intelligence",
  description:
    "A real-time sentiment analysis platform built on Hugging Face transformers. Analyze customer feedback, monitor live sentiment pulses, and explore trends — all in your browser.",
  keywords: [
    "sentiment analysis",
    "NLP",
    "Hugging Face",
    "Transformers.js",
    "real-time analytics",
    "customer feedback",
    "final year project",
  ],
  authors: [{ name: "Sentira" }],
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "Sentira — Real-time Sentiment Intelligence",
    description:
      "Live in-browser sentiment analysis powered by Hugging Face transformers.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sentira — Real-time Sentiment Intelligence",
    description: "Live in-browser sentiment analysis powered by Hugging Face.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${fraunces.variable} ${jetbrains.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          <SonnerToaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
