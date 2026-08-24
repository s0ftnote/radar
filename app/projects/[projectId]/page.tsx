import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SourceNetwork } from "@/components/source-network";
import { getProject } from "@/lib/projects";
import { listProjectSources, type ProjectSource } from "@/lib/sources";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = getProject(projectId);

  if (!project) notFound();
  const sources = listProjectSources(projectId);
  const sourceState = projectSourceState(sources);

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
          <span className={`status-badge ${sourceState.badgeClass}`}>{sourceState.badge}</span>
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
            <h2>{sourceState.heading}</h2>
            <p>{sourceState.guidance}</p>
            <p className="quiet-note">来源事实会属于本地 Radar 实例；这个 Project 只拥有自己的匹配与判断。</p>
          </aside>
        </div>

        <SourceNetwork projectId={projectId} sources={sources} />
      </main>
    </AppShell>
  );
}

function projectSourceState(sources: ProjectSource[]) {
  const activeSources = sources.filter((source) => source.active);
  if (activeSources.length === 0) {
    return sources.length === 0
      ? {
          badge: "等待来源",
          badgeClass: "status-paused",
          heading: "下一步",
          guidance: "添加一个公开 RSS/Atom 来源，先验证它，再开始积累可检查的内容版本。",
        }
      : {
          badge: "采集已暂停",
          badgeClass: "status-paused",
          heading: "恢复观察",
          guidance: "重新验证一个已知或新的来源 URL，即可恢复手动采集；既有版本会继续保留。",
        };
  }
  if (activeSources.some((source) => source.healthStatus === "unhealthy")) {
    return {
      badge: "来源需处理",
      badgeClass: "status-attention",
      heading: "修复来源",
      guidance: "查看 Source Network 中的失败原因；修复公开 URL 或网络后，可以直接重试采集。",
    };
  }
  if (activeSources.every((source) => source.versions.length === 0)) {
    return {
      badge: "准备采集",
      badgeClass: "status-ready",
      heading: "开始采集",
      guidance: "来源已经通过验证。运行首次采集，建立第一批可检查的不可变版本。",
    };
  }
  return {
    badge: "持续观察",
    badgeClass: "status-ready",
    heading: "保持节奏",
    guidance: "需要新鲜事实时再次手动采集；没有变化的内容会复用既有版本。",
  };
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}
