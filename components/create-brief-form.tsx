"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function CreateBriefForm() {
  const router = useRouter();
  const [state, setState] = useState<SubmissionState>({ status: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState({ status: "submitting" });

    try {
      const response = await fetch("/api/briefs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), description: data.get("description") }),
      });
      const result = (await response.json()) as { error?: string; name?: string };
      if (!response.ok) throw new Error(result.error ?? "创建失败");

      form.reset();
      setState({ status: "success", message: `${result.name} 已保存到本地。` });
      router.refresh();
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof TypeError
          ? "Radar 暂时无法连接，Radar Brief 没有保存，请重试。"
          : error instanceof Error ? error.message : "Radar Brief 没有保存，请重试。",
      });
    }
  }

  return (
    <section className="create-brief" aria-labelledby="create-brief-title">
      <div>
        <h2 id="create-brief-title">开始一条长期关注线</h2>
        <p>先用自己的话说明想持续知道什么。这里保存的是原始 Brief，不是关键词规则。</p>
      </div>
      <form onSubmit={submit} aria-busy={state.status === "submitting"}>
        <label>
          <span>Brief 名称</span>
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            autoComplete="off"
            placeholder="例如：Agent 工具需求"
          />
        </label>
        <label>
          <span>Radar Brief</span>
          <textarea
            name="description"
            required
            minLength={10}
            maxLength={2000}
            rows={6}
            placeholder="我想持续知道……"
          />
        </label>
        <button className="button button-primary" type="submit" disabled={state.status === "submitting"}>
          {state.status === "submitting" ? "正在保存…" : "创建 Radar Brief"}
        </button>
        <p
          className={`form-status ${state.status === "error" ? "form-status-error" : ""} ${state.status === "success" ? "form-status-success" : ""}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {state.status === "submitting"
            ? "正在保存 Radar Brief…"
            : state.status === "success" || state.status === "error" ? state.message : " "}
        </p>
      </form>
    </section>
  );
}
