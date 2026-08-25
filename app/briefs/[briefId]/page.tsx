import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BriefSources } from "@/components/brief-sources";
import { getBrief } from "@/lib/briefs";
import {
  listAvailableInstanceSources,
  listBriefSources,
  type AvailableInstanceSource,
  type BriefSource,
} from "@/lib/sources";

export const dynamic = "force-dynamic";

export default async function BriefPage({ params }: { params: Promise<{ briefId: string }> }) {
  const { briefId } = await params;
  const brief = getBrief(briefId);

  if (!brief) notFound();
  const sources = listBriefSources(briefId);
  const availableSources = listAvailableInstanceSources(briefId);
  const sourceState = briefSourceState(sources, availableSources);

  return (
    <AppShell>
      <main id="main-content" className="page-grid brief-detail">
        <nav className="breadcrumb" aria-label="面包屑">
          <Link href="/">Radar Brief</Link>
          <span aria-hidden="true">/</span>
          <span>{brief.name}</span>
        </nav>

        <section className="brief-heading">
          <div>
            <h1>{brief.name}</h1>
            <p>这个空间的判断将始终与其他 Radar Brief 隔离。</p>
          </div>
          <span className={`status-badge ${sourceState.badgeClass}`}>{sourceState.badge}</span>
        </section>

        <div className="detail-grid">
          <article className="brief-document">
            <div className="section-title-row">
              <h2>Radar Brief</h2>
              <span>Brief 修订 {brief.currentRevision.number}</span>
            </div>
            <p className="brief-copy">{brief.currentRevision.description}</p>
            <dl className="provenance-list">
              <div>
                <dt>Brief 身份</dt>
                <dd>{brief.id}</dd>
              </div>
              <div>
                <dt>Brief 修订身份</dt>
                <dd>{brief.currentRevision.id}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>
                  <time dateTime={brief.createdAt}>{formatDateTime(brief.createdAt)}</time>
                </dd>
              </div>
            </dl>
          </article>

          <aside className="next-step">
            <h2>{sourceState.heading}</h2>
            <p>{sourceState.guidance}</p>
            <p className="quiet-note">
              来源内容属于本地 Radar 实例；判断由你自己的 Agent 通过 Radar Skill 写回，只属于这个 Brief。
            </p>
          </aside>
        </div>

        <BriefSources briefId={briefId} sources={sources} availableSources={availableSources} />
      </main>
    </AppShell>
  );
}

function briefSourceState(sources: BriefSource[], availableSources: AvailableInstanceSource[]) {
  const activeSources = sources.filter((source) => source.active);
  if (activeSources.length === 0) {
    if (sources.length === 0 && availableSources.some((source) => source.contentCount > 0)) {
      return {
        badge: "可复用来源",
        badgeClass: "status-ready",
        heading: "接入已有来源",
        guidance: "本地实例已有取得过的来源。直接接入这个 Brief，即可复用来源内容并开始独立判断。",
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
          guidance: "添加一个公开 RSS/Atom 来源，先验证它，再开始积累可检查的来源内容。",
        }
      : {
          badge: "采集已暂停",
          badgeClass: "status-paused",
          heading: "恢复观察",
          guidance: "重新接入已停止来源，即可恢复手动采集；也可以验证新的公开 URL。已取得的来源内容继续保留。",
        };
  }
  if (activeSources.some((source) => source.healthStatus === "unhealthy")) {
    return {
      badge: "来源需处理",
      badgeClass: "status-attention",
      heading: "修复来源",
      guidance: "查看来源列表中的失败原因；修复公开 URL 或网络后，可以直接重试采集。",
    };
  }
  if (activeSources.every((source) => source.contents.length === 0)) {
    return {
      badge: "准备采集",
      badgeClass: "status-ready",
      heading: "开始采集",
      guidance: "来源已经通过验证。运行首次采集，建立第一批可检查的来源内容。",
    };
  }
  return {
    badge: "持续观察",
    badgeClass: "status-ready",
    heading: "保持节奏",
    guidance: "已采集的来源内容排在这个 Brief 的待判断队列里，等你自己的 Agent 通过 Radar Skill 判断。",
  };
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}
