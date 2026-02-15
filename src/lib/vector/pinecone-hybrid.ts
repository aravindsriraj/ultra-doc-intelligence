import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

import { env, requireEnv } from "@/lib/env";
import { ChunkRecord, DocumentMetadata, SourceSnippet } from "@/lib/types";

const DEFAULT_ALPHA = env.hybridAlpha;
const EMBED_BATCH_SIZE = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function getIndex() {
  requireEnv("pineconeApiKey", "pineconeIndexName");

  const pinecone = new Pinecone({ apiKey: env.pineconeApiKey as string });

  if (env.pineconeIndexHost) {
    return pinecone.index<DocumentMetadata>({ host: env.pineconeIndexHost });
  }

  return pinecone.index<DocumentMetadata>({ name: env.pineconeIndexName });
}

export async function embedDenseBatch(texts: string[]): Promise<number[][]> {
  requireEnv("openAiApiKey");

  const openai = new OpenAI({ apiKey: env.openAiApiKey });

  const response = await openai.embeddings.create({
    model: env.openAiEmbeddingModel,
    input: texts,
    ...(env.openAiEmbeddingDimensions ? { dimensions: env.openAiEmbeddingDimensions } : {}),
  });

  return response.data.map((item) => item.embedding);
}

async function embedSparseBatch(texts: string[], inputType: "query" | "passage") {
  requireEnv("pineconeApiKey");
  const pinecone = new Pinecone({ apiKey: env.pineconeApiKey as string });

  const embeddings = await pinecone.inference.embed({
    model: env.pineconeSparseModel,
    inputs: texts,
    parameters: {
      input_type: inputType,
      truncate: "END",
    },
  });

  return embeddings.data.map((item) => {
    const sparseValues = "sparseValues" in item ? item.sparseValues : [];
    const sparseIndices = "sparseIndices" in item ? item.sparseIndices : [];

    return {
      indices: sparseIndices,
      values: sparseValues,
    };
  });
}

async function batch<TInput, TOutput>(
  items: TInput[],
  size: number,
  fn: (batchItems: TInput[]) => Promise<TOutput[]>,
): Promise<TOutput[]> {
  const output: TOutput[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const result = await fn(chunk);
    output.push(...result);
  }
  return output;
}

export async function upsertHybridChunks(params: {
  chunks: ChunkRecord[];
  namespace: string;
}): Promise<void> {
  if (params.chunks.length === 0) {
    return;
  }

  const index = getIndex();
  const chunkTexts = params.chunks.map((chunk) => chunk.text);

  const denseEmbeddings = await batch(chunkTexts, EMBED_BATCH_SIZE, embedDenseBatch);
  const sparseEmbeddings = await batch(chunkTexts, EMBED_BATCH_SIZE, (batchItems) =>
    embedSparseBatch(batchItems, "passage"),
  );

  const records = params.chunks.map((chunk, idx) => ({
    id: chunk.id,
    values: denseEmbeddings[idx],
    sparseValues: sparseEmbeddings[idx],
    metadata: chunk.metadata,
  }));

  await index.upsert({
    namespace: params.namespace,
    records,
  });

  // Pinecone is eventually consistent. A short delay improves read-after-write behavior in POC flows.
  await new Promise((resolve) => setTimeout(resolve, 1200));
}

export async function queryHybrid(params: {
  query: string;
  namespace: string;
  documentId?: string;
  documentIds?: string[];
  topK?: number;
  alpha?: number;
}): Promise<SourceSnippet[]> {
  const index = getIndex();

  const dense = (await embedDenseBatch([params.query]))[0] ?? [];
  const sparse = (await embedSparseBatch([params.query], "query"))[0] ?? { indices: [], values: [] };

  const alpha = clamp(params.alpha ?? DEFAULT_ALPHA, 0, 1);

  const weightedDense = dense.map((value) => value * alpha);
  const weightedSparse = {
    indices: sparse.indices,
    values: sparse.values.map((value) => value * (1 - alpha)),
  };

  const filter =
    params.documentIds && params.documentIds.length > 0
      ? {
          document_id: { $in: params.documentIds },
        }
      : params.documentId
        ? {
            document_id: { $eq: params.documentId },
          }
        : undefined;

  const queryResponse = await index.query({
    namespace: params.namespace,
    vector: weightedDense,
    sparseVector: weightedSparse,
    topK: params.topK ?? 8,
    includeMetadata: true,
    includeValues: false,
    ...(filter ? { filter } : {}),
  });

  return queryResponse.matches
    .map((match) => {
      if (!match.id || !match.metadata) return null;
      const metadata = match.metadata as DocumentMetadata;
      const text = typeof metadata.chunk_text === "string" ? metadata.chunk_text : "";
      return {
        id: match.id,
        score: roundTo(match.score ?? 0),
        text,
        metadata,
      } satisfies SourceSnippet;
    })
    .filter((item): item is SourceSnippet => item !== null);
}

export async function fetchDocumentChunks(params: {
  namespace: string;
  documentId: string;
  pageSize?: number;
}): Promise<SourceSnippet[]> {
  const index = getIndex();
  const pageSize = params.pageSize ?? 200;

  const collected: SourceSnippet[] = [];
  let paginationToken: string | undefined;

  do {
    const response = await index.fetchByMetadata({
      namespace: params.namespace,
      filter: {
        document_id: { $eq: params.documentId },
      },
      limit: pageSize,
      ...(paginationToken ? { paginationToken } : {}),
    });

    const records = Object.entries(response.records ?? {});
    for (const [id, record] of records) {
      const metadata = (record.metadata ?? null) as DocumentMetadata | null;
      if (!metadata) continue;

      const text = typeof metadata.chunk_text === "string" ? metadata.chunk_text : "";
      collected.push({
        id,
        score: 0,
        text,
        metadata,
      });
    }

    paginationToken = response.pagination?.next;
  } while (paginationToken);

  return collected.sort((a, b) => {
    const left = Number(a.metadata.chunk_number ?? 0);
    const right = Number(b.metadata.chunk_number ?? 0);
    return left - right;
  });
}
