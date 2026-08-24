import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { JudgmentWorkbench } from "@/components/judgment-workbench";
import { MaterialPackageWorkbench } from "@/components/material-package-workbench";
import { ReportWorkbench } from "@/components/report-workbench";
import { SourceNetwork } from "@/components/source-network";
import { getIntelligenceWorkspace, type IntelligenceWorkspace } from "@/lib/intelligence";
import {
  getMaterialPackageWorkspace,
  hasUnresolvedMaterialPackageFailure,
  type MaterialPackageWorkspace,
} from "@/lib/material-packages";
import { getProject } from "@/lib/projects";
import { getReportWorkspace, type ReportWorkspace } from "@/lib/reports";
import {
  listAvailableInstanceSources,
  listProjectSources,
  type AvailableInstanceSource,
  type ProjectSource,
} from "@/lib/sources";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = getProject(projectId);

  if (!project) notFound();
  const sources = listProjectSources(projectId);
  const availableSources = listAvailableInstanceSources(projectId);
  const intelligenceWorkspace = getIntelligenceWorkspace(projectId);
  const reportWorkspace = getReportWorkspace(projectId);
  const materialPackageWorkspace = getMaterialPackageWorkspace(projectId);
  const sourceState = projectSourceState(
    sources,
    intelligenceWorkspace,
    reportWorkspace,
    materialPackageWorkspace,
    project.currentBriefRevision.id,
    availableSources,
  );

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

        <SourceNetwork projectId={projectId} sources={sources} availableSources={availableSources} />
        <JudgmentWorkbench projectId={projectId} workspace={intelligenceWorkspace} />
        <ReportWorkbench
          projectId={projectId}
          availableItems={intelligenceWorkspace.items}
          workspace={reportWorkspace}
        />
        <MaterialPackageWorkbench
          projectId={projectId}
          reports={reportWorkspace.reports}
          workspace={materialPackageWorkspace}
        />
      </main>
    </AppShell>
  );
}

function projectSourceState(
  sources: ProjectSource[],
  workspace: IntelligenceWorkspace,
  reportWorkspace: ReportWorkspace,
  materialPackageWorkspace: MaterialPackageWorkspace,
  briefRevisionId: string,
  availableSources: AvailableInstanceSource[],
) {
  const activeSources = sources.filter((source) => source.active);
  if (activeSources.length === 0) {
    if (sources.length === 0 && availableSources.some((source) => source.versionCount > 0)) {
      return {
        badge: "可复用来源",
        badgeClass: "status-ready",
        heading: "接入已有来源",
        guidance: "本地实例已有取得过的来源。直接接入这个 Project，即可复用版本并开始独立判断。",
      };
    }
    if (sources.length === 0 && availableSources.length > 0) {
      return {
        badge: "已有来源配置",
        badgeClass: "status-ready",
        heading: "接入已有来源",
        guidance: "本地实例已有尚未采集的来源。直接接入，不必再次验证 URL，然后运行首次采集。",
      };
    }
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
          guidance: "在 Source Network 中重新接入已停止来源，即可恢复手动采集；也可以验证新的公开 URL。既有版本继续保留。",
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
  const currentRuns = workspace.runs.filter((run) => run.briefRevisionId === briefRevisionId);
  const successfulVersions = new Set(
    currentRuns.filter((run) => run.status === "success").map((run) => run.sourceVersionId),
  );
  const retryableFailure = currentRuns.some(
    (run) => run.status === "failed" && !successfulVersions.has(run.sourceVersionId),
  );
  if (retryableFailure) {
    return {
      badge: "判断需重试",
      badgeClass: "status-attention",
      heading: "重试 Radar 判断",
      guidance: "已完成结果仍然保留。查看 Agent 失败原因，然后重试尚未完成的来源版本。",
    };
  }
  if (currentRuns.some((run) => run.status === "running")) {
    return {
      badge: "正在判断",
      badgeClass: "status-ready",
      heading: "等待 Agent",
      guidance: "Radar 正在用当前 Brief 修订判断来源版本；完成后会保留匹配、无匹配或失败状态。",
    };
  }
  if (workspace.sourceVersionCount > successfulVersions.size) {
    return {
      badge: "待判断",
      badgeClass: "status-ready",
      heading: "运行 Radar 判断",
      guidance: "已有尚未判断的来源版本。运行 Agent，把相关 Signal 沉淀为可追溯的情报条目。",
    };
  }
  if (reportWorkspace.runs.some((run) => run.status === "running")) {
    return {
      badge: "正在生成 Report",
      badgeClass: "status-ready",
      heading: "等待 Report Agent",
      guidance: "本次输入快照已经固定；Agent 完成后会创建新 Report，历史结果不会被覆盖。",
    };
  }
  if (hasUnresolvedReportFailure(reportWorkspace)) {
    return {
      badge: "Report 需重试",
      badgeClass: "status-attention",
      heading: "重试 Report 生成",
      guidance: "失败运行保留了完整输入快照和原因；按原输入重试不会影响已有 Report。",
    };
  }
  if (hasUnresolvedMaterialPackageFailure(materialPackageWorkspace)) {
    return {
      badge: "HTML 包需重试",
      badgeClass: "status-attention",
      heading: "重试 HTML 物料包",
      guidance: "Report 已经成功且保持不变；查看包生成原因，再按原固定快照重试。",
    };
  }
  if (workspace.items.length > 0 && reportWorkspace.reports.length === 0) {
    return {
      badge: "准备输出",
      badgeClass: "status-ready",
      heading: "生成固定 Report",
      guidance: "选择一个或多个情报条目，明确目的、受众和角度，生成第一份固定快照 Report。",
    };
  }
  return {
    badge: "持续观察",
    badgeClass: "status-ready",
    heading: "保持节奏",
    guidance: "需要新鲜事实时再次手动采集；没有变化的内容会复用既有版本。",
  };
}

function hasUnresolvedReportFailure(workspace: ReportWorkspace): boolean {
  const runsById = new Map(workspace.runs.map((run) => [run.id, run]));
  const resolvedFailures = new Set<string>();
  for (const run of workspace.runs) {
    if (run.status !== "success") continue;
    let retriedFromRunId = run.retriedFromRunId;
    while (retriedFromRunId) {
      resolvedFailures.add(retriedFromRunId);
      retriedFromRunId = runsById.get(retriedFromRunId)?.retriedFromRunId ?? null;
    }
  }
  return workspace.runs.some((run) => run.status === "failed" && !resolvedFailures.has(run.id));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}
