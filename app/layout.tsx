import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display, Space_Mono, Jost } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "600"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "WEE Cash Flow & Business Intelligence Platform",
  description: "Plataforma de gestão de fluxo de caixa, tesouraria e inteligência financeira para pequenas empresas.",
  icons: {
    icon: [
      { url: '/logo2.jpg', type: 'image/jpeg' },
    ],
    shortcut: '/logo2.jpg',
    apple: '/logo2.jpg',
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${spaceMono.variable} ${jost.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
