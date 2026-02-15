import { randomUUID } from "node:crypto";

import { createChunksFromPages } from "@/lib/chunking";
import { env } from "@/lib/env";
import { extractShipmentData } from "@/lib/extraction/shipment";
import { parseDocumentWithLlamaCloud } from "@/lib/parsing/llama-parse";
import { runRagWorkflow } from "@/lib/rag/workflow";
import {
  getLatestDocumentId,
  getRegistryItem,
  listRegistryItems,
  saveRegistryItem,
} from "@/lib/storage/registry";
import {
  AskResponse,
  ExtractResponse,
  IndexedDocument,
  ParsedDocumentPayload,
  UploadResponse,
} from "@/lib/types";
import { fetchDocumentChunks, upsertHybridChunks } from "@/lib/vector/pinecone-hybrid";

const SUPPORTED_FILE_TYPES = ["pdf", "docx", "txt"];
const DEFAULT_TENANT = "tenant-demo";

export class DocIntelligenceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DocIntelligenceError";
    this.status = status;
  }
}

function buildNamespace(tenantId: string): string {
  return `${env.pineconeNamespace}:${tenantId}`;
}

function getExtension(fileName: string): string {
  const raw = fileName.split(".").pop()?.toLowerCase() ?? "";
  return raw;
}

async function parseFile(params: {
  file: File;
  documentId: string;
  tenantId: string;
  fileName: string;
  uploadedAt: string;
}): Promise<ParsedDocumentPayload> {
  const extension = getExtension(params.fileName);

  if (extension === "txt") {
    const text = await params.file.text();
    return {
      documentId: params.documentId,
      tenantId: params.tenantId,
      fileName: params.fileName,
      uploadedAt: params.uploadedAt,
      textFull: text,
      markdownFull: text,
      pageTexts: [{ pageNumber: 1, text }],
    };
  }

  return parseDocumentWithLlamaCloud(params);
}

async function resolveDocumentContext(documentId?: string): Promise<{
  documentId: string;
  namespace: string;
  tenantId: string;
}> {
  const selectedDocumentId = documentId ?? (await getLatestDocumentId());

  if (!selectedDocumentId) {
    throw new DocIntelligenceError("No uploaded document found. Upload a document first.", 404);
  }

  const registryItem = await getRegistryItem(selectedDocumentId);
  if (!registryItem) {
    throw new DocIntelligenceError(`Document '${selectedDocumentId}' was not found.`, 404);
  }

  return {
    documentId: selectedDocumentId,
    namespace: registryItem.namespace,
    tenantId: registryItem.tenantId,
  };
}

async function resolveAskContext(params: {
  documentId?: string;
  documentIds?: string[];
}): Promise<{
  namespace: string;
  tenantId: string;
  documentIds: string[];
}> {
  const rawIds = (params.documentIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (rawIds.length > 0) {
    const uniqueIds = [...new Set(rawIds)];
    const items = await Promise.all(uniqueIds.map((id) => getRegistryItem(id)));

    const missingIds = uniqueIds.filter((id, idx) => !items[idx]);
    if (missingIds.length > 0) {
      throw new DocIntelligenceError(`Document(s) not found: ${missingIds.join(", ")}`, 404);
    }

    const resolved = items.filter((item): item is NonNullable<typeof item> => item !== null);
    const namespace = resolved[0].namespace;
    const tenantId = resolved[0].tenantId;

    const allSameNamespace = resolved.every((item) => item.namespace === namespace);
    if (!allSameNamespace) {
      throw new DocIntelligenceError(
        "Selected documents belong to different namespaces. Please select documents from the same tenant.",
        400,
      );
    }

    return {
      namespace,
      tenantId,
      documentIds: uniqueIds,
    };
  }

  const single = await resolveDocumentContext(params.documentId);
  return {
    namespace: single.namespace,
    tenantId: single.tenantId,
    documentIds: [single.documentId],
  };
}

export async function uploadDocument(params: {
  file: File;
  tenantId?: string;
}): Promise<UploadResponse> {
  const tenantId = params.tenantId?.trim() || DEFAULT_TENANT;
  const fileName = params.file.name || `upload-${Date.now()}`;
  const extension = getExtension(fileName);

  if (!SUPPORTED_FILE_TYPES.includes(extension)) {
    throw new DocIntelligenceError(
      `Unsupported file type '${extension || "unknown"}'. Supported: ${SUPPORTED_FILE_TYPES.join(", ")}.`,
      400,
    );
  }

  const documentId = randomUUID();
  const uploadedAt = new Date().toISOString();

  const parsed = await parseFile({
    file: params.file,
    documentId,
    tenantId,
    fileName,
    uploadedAt,
  });

  const fallbackText = parsed.markdownFull || parsed.textFull;
  const pageTexts =
    parsed.pageTexts.length > 0 ? parsed.pageTexts : [{ pageNumber: 1, text: fallbackText || "(empty document)" }];

  const chunks = createChunksFromPages({
    documentId,
    tenantId,
    fileName,
    uploadedAt,
    pageTexts,
  });

  if (chunks.length === 0) {
    throw new DocIntelligenceError("Could not extract usable text from this document.", 422);
  }

  const namespace = buildNamespace(tenantId);

  await upsertHybridChunks({
    chunks,
    namespace,
  });

  await saveRegistryItem({
    documentId,
    fileName,
    uploadedAt,
    namespace,
    tenantId,
    chunkCount: chunks.length,
  });

  return {
    document_id: documentId,
    file_name: fileName,
    chunk_count: chunks.length,
    namespace,
    uploaded_at: uploadedAt,
  };
}

export async function askDocumentQuestion(params: {
  question: string;
  documentId?: string;
  documentIds?: string[];
}): Promise<AskResponse> {
  const question = params.question.trim();
  if (question.length === 0) {
    throw new DocIntelligenceError("Question cannot be empty.", 400);
  }

  const context = await resolveAskContext({
    documentId: params.documentId,
    documentIds: params.documentIds,
  });

  return runRagWorkflow({
    question,
    namespace: context.namespace,
    documentIds: context.documentIds,
  });
}

export async function extractShipmentFromDocument(params: {
  documentId?: string;
  documentIds?: string[];
}): Promise<ExtractResponse> {
  const rawIds = (params.documentIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const resolvedIds =
    rawIds.length > 0
      ? [...new Set(rawIds)]
      : [
          (
            await resolveDocumentContext(params.documentId)
          ).documentId,
        ];

  const results: ExtractResponse["results"] = [];

  for (const documentId of resolvedIds) {
    const registryItem = await getRegistryItem(documentId);
    if (!registryItem) {
      throw new DocIntelligenceError(`Document '${documentId}' was not found.`, 404);
    }

    const chunks = await fetchDocumentChunks({
      namespace: registryItem.namespace,
      documentId,
    });
    const sourceText = chunks.map((chunk) => chunk.text).join("\n\n").trim();

    if (sourceText.length === 0) {
      throw new DocIntelligenceError(
        `No indexed chunk content found for document '${documentId}'. Re-upload and try again.`,
        404,
      );
    }

    const { extraction, confidence } = await extractShipmentData({
      text: sourceText,
      fileName: registryItem.fileName,
    });

    results.push({
      document_id: documentId,
      file_name: registryItem.fileName,
      extraction,
      confidence,
    });
  }

  return {
    results,
    total: results.length,
  };
}

export async function getLatestDocumentSummary(): Promise<{
  document_id: string;
  file_name: string;
  uploaded_at: string;
  namespace: string;
  chunk_count: number;
} | null> {
  const latestId = await getLatestDocumentId();
  if (!latestId) return null;

  const item = await getRegistryItem(latestId);
  if (!item) return null;

  return {
    document_id: item.documentId,
    file_name: item.fileName,
    uploaded_at: item.uploadedAt,
    namespace: item.namespace,
    chunk_count: item.chunkCount,
  };
}

export async function listIndexedDocuments(): Promise<IndexedDocument[]> {
  const items = await listRegistryItems();
  return items.map((item) => ({
    document_id: item.documentId,
    file_name: item.fileName,
    uploaded_at: item.uploadedAt,
    namespace: item.namespace,
    chunk_count: item.chunkCount,
  }));
}
