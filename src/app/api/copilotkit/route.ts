import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

import { env, requireEnv } from "@/lib/env";
import {
  askDocumentQuestion,
  extractShipmentFromDocument,
  getLatestDocumentSummary,
} from "@/lib/services/doc-intelligence";

const copilotRuntime = new CopilotRuntime({
  actions: [
    {
      name: "ask_document",
      description:
        "Answer a question using the uploaded logistics document. If document_id is omitted, use the latest uploaded document.",
      parameters: [
        {
          name: "question",
          type: "string",
          description: "Natural language question about the uploaded logistics document",
          required: true,
        },
        {
          name: "document_id",
          type: "string",
          description: "Optional specific document id",
          required: false,
        },
        {
          name: "document_ids",
          type: "string[]",
          description: "Optional list of document ids for multi-document retrieval",
          required: false,
        },
      ],
      handler: async (args: { question: string; document_id?: string; document_ids?: string[] }) => {
        return askDocumentQuestion({
          question: args.question,
          documentId: args.document_id,
          documentIds: args.document_ids,
        });
      },
    },
    {
      name: "extract_shipment",
      description:
        "Extract structured shipment fields from one or more logistics documents. If document_id/document_ids are omitted, use the latest uploaded document.",
      parameters: [
        {
          name: "document_id",
          type: "string",
          description: "Optional specific document id",
          required: false,
        },
        {
          name: "document_ids",
          type: "string[]",
          description: "Optional list of document ids for multi-document extraction",
          required: false,
        },
      ],
      handler: async (args: { document_id?: string; document_ids?: string[] }) => {
        return extractShipmentFromDocument({
          documentId: args.document_id,
          documentIds: args.document_ids,
        });
      },
    },
    {
      name: "get_latest_document",
      description: "Return metadata for the latest uploaded logistics document.",
      handler: async () => {
        const latest = await getLatestDocumentSummary();
        if (!latest) {
          return { message: "No uploaded document found yet." };
        }

        return latest;
      },
    },
  ],
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  requireEnv("openAiApiKey");

  const serviceAdapter = new OpenAIAdapter({
    model: env.openAiChatModel,
  });

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotRuntime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(request);
}
