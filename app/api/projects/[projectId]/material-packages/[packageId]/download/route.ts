import { NextResponse } from "next/server";
import { readMaterialPackageDownload } from "@/lib/material-packages";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; packageId: string }> },
) {
  try {
    const { projectId, packageId } = await context.params;
    const content = await readMaterialPackageDownload(projectId, packageId);
    return new NextResponse(new Uint8Array(content), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="radar-html-package-${packageId}.zip"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "找不到可下载的 HTML 物料包。" }, { status: 404 });
  }
}
