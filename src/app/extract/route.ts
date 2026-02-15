import { NextResponse } from "next/server";
import { z } from "zod";

import { DocIntelligenceError, extractShipmentFromDocument } from "@/lib/services/doc-intelligence";

export const runtime = "nodejs";

const ExtractRequestSchema = z.object({
  document_id: z.string().optional(),
  document_ids: z.array(z.string().min(1)).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = ExtractRequestSchema.parse(body);

    const response = await extractShipmentFromDocument({
      documentId: input.document_id,
      documentIds: input.document_ids,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
    }

    if (error instanceof DocIntelligenceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Failed to extract shipment data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
