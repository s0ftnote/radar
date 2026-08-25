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
  title: "Radar · 本地信号聚合站",
  description: "在自己控制的设备上按 Radar Brief 持续采集来源内容，交给自己的 Agent 判断。",
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
