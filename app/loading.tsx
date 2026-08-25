import { AppShell } from "@/components/app-shell";

export default function Loading() {
  return (
    <AppShell>
      <main id="main-content" className="page-grid" aria-busy="true" aria-label="正在加载 Radar Brief">
        <div className="skeleton skeleton-heading" />
        <div className="workspace-grid">
          <div className="skeleton skeleton-panel" />
          <div className="skeleton skeleton-panel" />
        </div>
      </main>
    </AppShell>
  );
}
