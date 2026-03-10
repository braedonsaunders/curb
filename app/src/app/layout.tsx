import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { AppFrame } from "./app-frame";

const sansFont = Manrope({
  subsets: ["latin"],
  variable: "--font-app-sans",
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-app-mono",
});

export const metadata: Metadata = {
  title: "Curb - Local Business Platform",
  description: "Discover, audit, and generate sites for local businesses",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sansFont.variable} ${monoFont.variable} font-sans antialiased`}>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
