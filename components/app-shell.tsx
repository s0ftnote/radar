import Link from "next/link";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="masthead">
        <Link className="wordmark" href="/" aria-label="Radar 首页">
          <strong>Radar</strong>
          <span>local signal station</span>
        </Link>
        <div className="masthead-meta">
          <span>单用户</span>
          <span aria-hidden="true">·</span>
          <span>本地优先</span>
        </div>
      </header>
      {children}
      <footer className="app-footer">
        <span>来源内容与判断保存在你控制的设备上。</span>
        <span>Radar · 本地信号聚合站</span>
      </footer>
    </div>
  );
}
