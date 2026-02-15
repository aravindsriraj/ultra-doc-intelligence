import { ChunkRecord } from "@/lib/types";

const DEFAULT_TARGET_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 180;

function splitIntoParagraphs(input: string): string[] {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  return normalized
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function buildOverlappingChunks(paragraphs: string[], targetChars: number, overlapChars: number): string[] {
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current.length === 0) {
      current = paragraph;
      continue;
    }

    const candidate = `${current}\n\n${paragraph}`;
    if (candidate.length <= targetChars) {
      current = candidate;
      continue;
    }

    chunks.push(current);

    const overlapText = current.slice(Math.max(0, current.length - overlapChars)).trim();
    current = overlapText ? `${overlapText}\n\n${paragraph}` : paragraph;

    if (current.length > targetChars * 1.5) {
      chunks.push(current.slice(0, targetChars));
      current = current.slice(targetChars - overlapChars).trim();
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function createChunksFromPages(params: {
  documentId: string;
  tenantId: string;
  fileName: string;
  uploadedAt: string;
  pageTexts: Array<{ pageNumber: number; text: string }>;
  targetChars?: number;
  overlapChars?: number;
}): ChunkRecord[] {
  const targetChars = params.targetChars ?? DEFAULT_TARGET_CHARS;
  const overlapChars = params.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const chunks: ChunkRecord[] = [];
  let globalChunkNumber = 1;

  for (const page of params.pageTexts) {
    const paragraphs = splitIntoParagraphs(page.text);
    const pageChunks = buildOverlappingChunks(paragraphs, targetChars, overlapChars);

    pageChunks.forEach((chunkText, pageIndex) => {
      const chunkId = `${params.documentId}#p${page.pageNumber}c${pageIndex + 1}`;
      chunks.push({
        id: chunkId,
        text: chunkText,
        metadata: {
          document_id: params.documentId,
          tenant_id: params.tenantId,
          document_title: params.fileName,
          source_file_name: params.fileName,
          uploaded_at: params.uploadedAt,
          page_number: page.pageNumber,
          chunk_number: globalChunkNumber,
          chunk_text: chunkText,
        },
      });
      globalChunkNumber += 1;
    });
  }

  return chunks;
}
