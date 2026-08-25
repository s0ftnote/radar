import Link from "next/link";

export default function BriefNotFound() {
  return (
    <main id="main-content" className="fatal-state">
      <h1>找不到这个 Radar Brief</h1>
      <p>它可能来自另一个本地数据目录，或地址不完整。</p>
      <Link className="button button-primary" href="/">
        返回 Radar Brief
      </Link>
    </main>
  );
}
