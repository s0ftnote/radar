import Link from "next/link";
import { CreateProjectForm } from "@/components/create-project-form";
import { AppShell } from "@/components/app-shell";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const projects = listProjects();

  return (
    <AppShell>
      <main id="main-content" className="page-grid">
        <section className="page-heading">
          <div>
            <h1>你的 Radar Projects</h1>
            <p>每个 Project 都是一条长期关注线。来源可以复用，判断彼此隔离。</p>
          </div>
          <span className="instance-status" aria-label="本地实例状态：运行中">
            <span aria-hidden="true" /> 本地实例运行中
          </span>
        </section>

        <div className="workspace-grid">
          <section className="project-list" aria-labelledby="project-list-title">
            <div className="section-title-row">
              <h2 id="project-list-title">Radar Projects</h2>
              <span>{projects.length} 个空间</span>
            </div>

            {projects.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">还没有 Radar Project</p>
                <p>从右侧写下一件你想持续知道的事。Radar 会把原始描述保留为首个 Brief 修订。</p>
              </div>
            ) : (
              <ul className="project-rows">
                {projects.map((project) => (
                  <li key={project.id}>
                    <Link href={`/projects/${project.id}`}>
                      <span className="project-row-copy">
                        <strong>{project.name}</strong>
                        <span>{project.currentBriefRevision.description}</span>
                      </span>
                      <span className="project-row-meta">
                        <time dateTime={project.createdAt}>{formatDate(project.createdAt)}</time>
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

          <CreateProjectForm />
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
