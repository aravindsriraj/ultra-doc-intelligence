import { NextResponse } from "next/server";

import { DocIntelligenceError, listIndexedDocuments } from "@/lib/services/doc-intelligence";

export const runtime = "nodejs";

export async function GET() {
  try {
    const documents = await listIndexedDocuments();
    return NextResponse.json({ documents }, { status: 200 });
  } catch (error) {
    if (error instanceof DocIntelligenceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to list indexed documents.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
