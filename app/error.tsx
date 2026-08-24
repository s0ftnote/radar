"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="fatal-state">
      <p className="overline">RADAR / LOCAL</p>
      <h1>本地工作台没有正确载入</h1>
      <p>检查启动终端中的诊断信息，确认数据目录可写，然后重试。</p>
      <button className="button button-primary" type="button" onClick={reset}>
        重新载入
      </button>
    </main>
  );
}
