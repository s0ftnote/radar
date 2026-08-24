import { NextResponse } from "next/server";
import { readMaterialPackageFile } from "@/lib/material-packages";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; packageId: string; path: string[] }> },
) {
  try {
    const { projectId, packageId, path } = await context.params;
    const file = await readMaterialPackageFile(projectId, packageId, path.join("/"));
    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        "content-type": file.mediaType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "找不到这个 HTML 物料包文件。" }, { status: 404 });
  }
}
