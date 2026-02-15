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

function sanitizeCopilotMessages(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;

  const input = payload as { messages?: unknown };
  if (!Array.isArray(input.messages)) return payload;

  const normalizedMessages = input.messages.map((message) => {
    if (!message || typeof message !== "object") return message;

    const next = { ...(message as Record<string, unknown>) };
    const role = typeof next.role === "string" ? next.role : "";

    // AG-UI style text messages can arrive without content in some edge cases.
    // Normalize to empty string so Copilot runtime validation does not fail.
    if (
      (role === "user" || role === "assistant" || role === "system" || role === "developer") &&
      (next.content === undefined || next.content === null)
    ) {
      next.content = "";
    }

    // Some clients may send GraphQL-style message envelopes.
    if ("textMessage" in next && next.textMessage && typeof next.textMessage === "object") {
      const textMessage = { ...(next.textMessage as Record<string, unknown>) };
      if (textMessage.content === undefined || textMessage.content === null) {
        textMessage.content = "";
      } else if (typeof textMessage.content !== "string") {
        textMessage.content = String(textMessage.content);
      }
      next.textMessage = textMessage;
    }

    return next;
  });

  return {
    ...(payload as Record<string, unknown>),
    messages: normalizedMessages,
  };
}

async function buildSafeCopilotRequest(request: Request): Promise<Request> {
  const cloned = request.clone();

  let body: unknown;
  try {
    body = await cloned.json();
  } catch {
    return request;
  }

  const sanitized = sanitizeCopilotMessages(body);
  const headers = new Headers(request.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(sanitized),
  });
}

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

  const safeRequest = await buildSafeCopilotRequest(request);
  return handleRequest(safeRequest);
}
