import Link from "next/link";
import { CreateBriefForm } from "@/components/create-brief-form";
import { AppShell } from "@/components/app-shell";
import { listBriefs } from "@/lib/briefs";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const briefs = listBriefs();

  return (
    <AppShell>
      <main id="main-content" className="page-grid">
        <section className="page-heading">
          <div>
            <h1>你的 Radar Brief</h1>
            <p>每个 Brief 都是一条长期关注线。来源内容可以共享，判断彼此隔离。</p>
          </div>
          <span className="instance-status" aria-label="本地实例状态：运行中">
            <span aria-hidden="true" /> 本地实例运行中
          </span>
        </section>

        <div className="workspace-grid">
          <section className="brief-list" aria-labelledby="brief-list-title">
            <div className="section-title-row">
              <h2 id="brief-list-title">已有 Brief</h2>
              <span>{briefs.length} 个空间</span>
            </div>

            {briefs.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">还没有 Radar Brief</p>
                <p>从右侧写下一件你想持续知道的事。Radar 会把原始描述保留为首个 Brief 修订。</p>
              </div>
            ) : (
              <ul className="brief-rows">
                {briefs.map((brief) => (
                  <li key={brief.id}>
                    <Link href={`/briefs/${brief.id}`}>
                      <span className="brief-row-copy">
                        <strong>{brief.name}</strong>
                        <span>{brief.currentRevision.description}</span>
                      </span>
                      <span className="brief-row-meta">
                        <time dateTime={brief.createdAt}>{formatDate(brief.createdAt)}</time>
                        <svg className="row-arrow" aria-hidden="true" viewBox="0 0 20 20">
                          <path d="M4 10h11M11 6l4 4-4 4" />
                        </svg>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <CreateBriefForm />
        </div>
      </main>
    </AppShell>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
