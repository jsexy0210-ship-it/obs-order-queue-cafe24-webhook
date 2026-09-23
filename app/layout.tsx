import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "망고TCG 관리자",
  description: "OBS Browser Source용 라이브 주문 대기열",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
