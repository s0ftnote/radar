import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <main id="main-content" className="fatal-state">
      <p className="overline">RADAR / PROJECT</p>
      <h1>找不到这个 Radar Project</h1>
      <p>它可能来自另一个本地数据目录，或地址不完整。</p>
      <Link className="button button-primary" href="/">
        返回 Projects
      </Link>
    </main>
  );
}
