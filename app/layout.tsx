import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./styles.css";

const editorial = localFont({
  src: "./fonts/ZCOOLXiaoWei-Regular.ttf",
  display: "swap",
  weight: "400",
  variable: "--font-editorial",
});

export const metadata: Metadata = {
  title: "Radar · 本地情报工作台",
  description: "在自己控制的设备上持续收集、判断与沉淀情报。",
  other: { "impeccable-form": "investigation-desk-e2d76f24" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={editorial.variable}>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
