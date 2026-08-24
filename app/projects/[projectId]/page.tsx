import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = getProject(projectId);

  if (!project) notFound();

  return (
    <AppShell>
      <main id="main-content" className="page-grid project-detail">
        <nav className="breadcrumb" aria-label="面包屑">
          <Link href="/">Radar Projects</Link>
          <span aria-hidden="true">/</span>
          <span>{project.name}</span>
        </nav>

        <section className="project-heading">
          <div>
            <h1>{project.name}</h1>
            <p>这个空间的判断将始终与其他 Radar Project 隔离。</p>
          </div>
          <span className="status-badge status-ready">准备采集</span>
        </section>

        <div className="detail-grid">
          <article className="brief-document">
            <div className="section-title-row">
              <h2>Radar Brief</h2>
              <span>Brief 修订 {project.briefRevision}</span>
            </div>
            <p className="brief-copy">{project.briefDescription}</p>
            <dl className="provenance-list">
              <div>
                <dt>Project 身份</dt>
                <dd>{project.id}</dd>
              </div>
              <div>
                <dt>Brief 身份</dt>
                <dd>{project.briefId}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>
                  <time dateTime={project.createdAt}>{formatDateTime(project.createdAt)}</time>
                </dd>
              </div>
            </dl>
          </article>

          <aside className="next-step">
            <h2>下一步：连接来源</h2>
            <p>Project 已持久化。接下来将在 Source Network 中添加公开 RSS 或 Atom 来源。</p>
            <p className="quiet-note">来源事实会属于本地 Radar 实例；这个 Project 只拥有自己的匹配与判断。</p>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}
