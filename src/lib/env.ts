function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const env = {
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiChatModel: process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini",
  openAiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large",
  openAiEmbeddingDimensions: parseOptionalInt(process.env.OPENAI_EMBEDDING_DIMENSIONS),

  llamaCloudApiKey: process.env.LLAMA_CLOUD_API_KEY,
  llamaParseTier:
    (process.env.LLAMA_PARSE_TIER as "fast" | "cost_effective" | "agentic" | "agentic_plus" | undefined) ??
    "agentic_plus",
  llamaParseVersion: process.env.LLAMA_PARSE_VERSION ?? "latest",

  pineconeApiKey: process.env.PINECONE_API_KEY,
  pineconeIndexName: process.env.PINECONE_INDEX_NAME,
  pineconeIndexHost: process.env.PINECONE_INDEX_HOST,
  pineconeNamespace: process.env.PINECONE_NAMESPACE ?? "tenant-demo",
  pineconeSparseModel: process.env.PINECONE_SPARSE_MODEL ?? "pinecone-sparse-english-v0",
  hybridAlpha: Number.parseFloat(process.env.HYBRID_ALPHA ?? "0.5"),

  guardrailMinTopScore: Number.parseFloat(process.env.GUARDRAIL_MIN_TOP_SCORE ?? "0.85"),
  guardrailLowConfidence: Number.parseFloat(process.env.GUARDRAIL_LOW_CONFIDENCE ?? "0.4"),
  guardrailCautionConfidence: Number.parseFloat(process.env.GUARDRAIL_CAUTION_CONFIDENCE ?? "0.6"),
};

export function requireEnv(...keys: Array<keyof typeof env>): void {
  const missing = keys.filter((key) => {
    const value = env[key];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
