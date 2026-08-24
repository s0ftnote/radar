import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SourceNetwork } from "@/components/source-network";
import { getProject } from "@/lib/projects";
import { listProjectSources } from "@/lib/sources";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = getProject(projectId);

  if (!project) notFound();
  const sources = listProjectSources(projectId);

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
              <span>Brief 修订 {project.currentBriefRevision.number}</span>
            </div>
            <p className="brief-copy">{project.currentBriefRevision.description}</p>
            <dl className="provenance-list">
              <div>
                <dt>Project 身份</dt>
                <dd>{project.id}</dd>
              </div>
              <div>
                <dt>Brief 修订身份</dt>
                <dd>{project.currentBriefRevision.id}</dd>
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
            <h2>下一步</h2>
            <p>添加一个公开 RSS/Atom 来源，先验证它，再开始积累可检查的内容版本。</p>
            <p className="quiet-note">来源事实会属于本地 Radar 实例；这个 Project 只拥有自己的匹配与判断。</p>
          </aside>
        </div>

        <SourceNetwork projectId={projectId} sources={sources} />
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
