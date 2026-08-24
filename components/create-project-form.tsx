"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function CreateProjectForm() {
  const router = useRouter();
  const [state, setState] = useState<SubmissionState>({ status: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState({ status: "submitting" });

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), brief: data.get("brief") }),
      });
      const result = (await response.json()) as { error?: string; name?: string };
      if (!response.ok) throw new Error(result.error ?? "创建失败");

      form.reset();
      setState({ status: "success", message: `${result.name} 已保存到本地。` });
      router.refresh();
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Project 没有保存，请重试。",
      });
    }
  }

  return (
    <section className="create-project" aria-labelledby="create-project-title">
      <div>
        <h2 id="create-project-title">开始一条长期关注线</h2>
        <p>先用自己的话说明想持续知道什么。这里保存的是原始 Brief，不是关键词规则。</p>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>Project 名称</span>
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
            name="brief"
            required
            minLength={10}
            maxLength={2000}
            rows={6}
            placeholder="我想持续知道……"
          />
        </label>
        <button className="button button-primary" type="submit" disabled={state.status === "submitting"}>
          {state.status === "submitting" ? "正在保存…" : "创建 Radar Project"}
        </button>
        <p
          className={`form-status ${state.status === "error" ? "form-status-error" : ""} ${state.status === "success" ? "form-status-success" : ""}`}
          aria-live="polite"
        >
          {state.status === "success" || state.status === "error" ? state.message : " "}
        </p>
      </form>
    </section>
  );
}
