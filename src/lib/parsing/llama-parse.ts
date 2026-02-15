import { LlamaCloud } from "@llamaindex/llama-cloud";

import { env, requireEnv } from "@/lib/env";
import { ParsedDocumentPayload } from "@/lib/types";

function toPageText(result: unknown): Array<{ pageNumber: number; text: string }> {
  if (!result || typeof result !== "object") return [];
  const maybePages = (result as { pages?: unknown }).pages;
  if (!Array.isArray(maybePages)) return [];

  return maybePages
    .map((page) => {
      if (!page || typeof page !== "object") return null;
      const pageNumber = Number((page as { page_number?: number }).page_number ?? 0);
      const text = String((page as { text?: string }).text ?? "").trim();
      if (!Number.isFinite(pageNumber) || pageNumber <= 0 || text.length === 0) return null;
      return { pageNumber, text };
    })
    .filter((value): value is { pageNumber: number; text: string } => value !== null);
}

function toMarkdown(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const maybePages = (result as { pages?: unknown }).pages;
  if (!Array.isArray(maybePages)) return "";

  return maybePages
    .map((page) => {
      if (!page || typeof page !== "object") return "";
      const success = Boolean((page as { success?: boolean }).success ?? true);
      if (!success) return "";
      return String((page as { markdown?: string }).markdown ?? "").trim();
    })
    .filter(Boolean)
    .join("\n\n");
}

export async function parseDocumentWithLlamaCloud(params: {
  file: File;
  documentId: string;
  tenantId: string;
  fileName: string;
  uploadedAt: string;
}): Promise<ParsedDocumentPayload> {
  requireEnv("llamaCloudApiKey");

  const client = new LlamaCloud({ apiKey: env.llamaCloudApiKey });

  const uploaded = await client.files.create({
    file: params.file,
    purpose: "parse",
  });

  const parsed = await client.parsing.parse({
    file_id: uploaded.id,
    tier: env.llamaParseTier,
    version: env.llamaParseVersion,
    output_options: {
      markdown: {
        tables: {
          output_tables_as_markdown: true,
        },
      },
    },
    expand: ["text", "markdown", "items", "images_content_metadata"],
  });

  const pageTexts = toPageText(parsed.text);
  const markdownByPages = toMarkdown(parsed.markdown);

  const textFull =
    (typeof parsed.text_full === "string" && parsed.text_full.trim().length > 0
      ? parsed.text_full
      : pageTexts.map((page) => page.text).join("\n\n")) ?? "";

  const markdownFull =
    (typeof parsed.markdown_full === "string" && parsed.markdown_full.trim().length > 0
      ? parsed.markdown_full
      : markdownByPages) ?? "";

  return {
    documentId: params.documentId,
    tenantId: params.tenantId,
    fileName: params.fileName,
    uploadedAt: params.uploadedAt,
    textFull,
    markdownFull,
    pageTexts,
  };
}
