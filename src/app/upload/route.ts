import { NextResponse } from "next/server";

import { DocIntelligenceError, uploadDocument } from "@/lib/services/doc-intelligence";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const tenantIdValue = formData.get("tenant_id");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Expected multipart/form-data with a 'file' field." },
        { status: 400 },
      );
    }

    const tenantId = typeof tenantIdValue === "string" ? tenantIdValue : undefined;
    const response = await uploadDocument({ file, tenantId });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof DocIntelligenceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to upload document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
