import { z } from "zod";
import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";

import { env, requireEnv } from "@/lib/env";
import { AskResponse, SourceSnippet } from "@/lib/types";
import { queryHybrid } from "@/lib/vector/pinecone-hybrid";

const TOP_K_PER_TOOL_CALL = 6;
const MAX_SOURCES_IN_STATE = 16;

const RewriteSchema = z.object({
  query: z.string(),
});

const AgentAnswerSchema = z.object({
  answer: z.string(),
  grounded: z.boolean(),
  not_found: z.boolean(),
  cited_chunk_ids: z.array(z.string()),
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mergeSources(existing: SourceSnippet[], incoming: SourceSnippet[], limit: number): SourceSnippet[] {
  const byId = new Map<string, SourceSnippet>();

  for (const source of [...existing, ...incoming]) {
    const current = byId.get(source.id);
    if (!current || source.score > current.score) {
      byId.set(source.id, source);
    }
  }

  return [...byId.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function buildContext(sources: SourceSnippet[], maxSources = 6): string {
  return sources
    .slice(0, maxSources)
    .map((source) => {
      const text = source.text.length > 900 ? `${source.text.slice(0, 900)}...` : source.text;
      return `chunk_id=${source.id}\nscore=${source.score}\npage=${source.metadata.page_number}\ntext=${text}`;
    })
    .join("\n\n----\n\n");
}

function calculateConfidence(params: {
  sources: SourceSnippet[];
  citedChunkIds: string[];
}): number {
  const topScore = params.sources[0]?.score ?? 0;
  const secondScore = params.sources[1]?.score ?? topScore;

  const retrievalSignal = clamp(topScore / 2.5, 0, 1);
  const agreementSignal = topScore > 0 ? clamp(secondScore / topScore, 0, 1) : 0;

  const sourceIds = new Set(params.sources.map((source) => source.id));
  const validCitations = params.citedChunkIds.filter((id) => sourceIds.has(id)).length;
  const citationSignal =
    params.citedChunkIds.length > 0 ? clamp(validCitations / params.citedChunkIds.length, 0, 1) : 0;

  return roundTo(0.6 * retrievalSignal + 0.25 * agreementSignal + 0.15 * citationSignal);
}

async function rewriteQuestion(question: string): Promise<string> {
  const model = new ChatOpenAI({
    apiKey: env.openAiApiKey,
    model: env.openAiChatModel,
    temperature: 0,
  });

  try {
    const output = await model.withStructuredOutput(RewriteSchema).invoke([
      {
        role: "system",
        content:
          "Rewrite the user question for retrieval. Keep entities, dates, and shipment IDs exact. Return concise query text.",
      },
      {
        role: "user",
        content: question,
      },
    ]);

    const rewritten = output.query.trim();
    return rewritten.length > 0 ? rewritten : question;
  } catch {
    return question;
  }
}

export async function runRagWorkflow(params: {
  question: string;
  namespace: string;
  documentIds: string[];
}): Promise<AskResponse> {
  requireEnv("openAiApiKey");

  const rewrittenQuery = await rewriteQuestion(params.question);
  const gatheredSources: SourceSnippet[] = [];

  const retrieveDocumentChunks = tool(
    async ({ query }: { query: string }) => {
      const sources = await queryHybrid({
        query,
        namespace: params.namespace,
        documentIds: params.documentIds,
        topK: TOP_K_PER_TOOL_CALL,
      });

      const merged = mergeSources(gatheredSources, sources, MAX_SOURCES_IN_STATE);
      gatheredSources.splice(0, gatheredSources.length, ...merged);

      if (sources.length === 0) {
        return "No relevant passages found for that query in this document.";
      }

      return buildContext(sources);
    },
    {
      name: "retrieve_document_chunks",
      description:
        "Retrieve relevant chunks from the selected logistics document. Call this tool multiple times with refined queries for complex questions.",
      schema: z.object({
        query: z.string().describe("Focused retrieval query for the logistics document"),
      }),
    },
  );

  const agent = createAgent({
    model: new ChatOpenAI({
      apiKey: env.openAiApiKey,
      model: env.openAiChatModel,
      temperature: 0,
    }),
    tools: [retrieveDocumentChunks],
    responseFormat: AgentAnswerSchema,
    systemPrompt:
      "You are a grounded logistics QA ReAct agent. Always use retrieve_document_chunks before answering. For complex or multi-part questions, call retrieve_document_chunks multiple times with refined queries. Answer only from retrieved evidence. If information is missing, return not_found=true and answer='Not found in document.'. cited_chunk_ids must contain exact chunk_id values from retrieved evidence.",
  });

  const agentResult = await agent.invoke({
    messages: [
      {
        role: "user",
        content: `Question: ${params.question}\n\nInitial retrieval query suggestion: ${rewrittenQuery}`,
      },
    ],
  });

  const structured =
    (agentResult.structuredResponse as z.infer<typeof AgentAnswerSchema> | undefined) ?? {
      answer: "Not found in document.",
      grounded: false,
      not_found: true,
      cited_chunk_ids: [],
    };

  const topScore = gatheredSources[0]?.score ?? 0;
  if (gatheredSources.length === 0 || topScore < env.guardrailMinTopScore) {
    return {
      document_id: params.documentIds[0] ?? "",
      document_ids: params.documentIds,
      answer: "Not found in document.",
      confidence: 0,
      guardrail: "not_found",
      rewritten_query: rewrittenQuery,
      sources: gatheredSources,
    };
  }

  let confidence = calculateConfidence({
    sources: gatheredSources,
    citedChunkIds: structured.cited_chunk_ids,
  });

  let guardrail: "ok" | "caution" | "not_found" = "ok";
  let answer = structured.answer.trim();

  if (structured.not_found || !structured.grounded) {
    guardrail = "not_found";
    answer = "Not found in document.";
    confidence = Math.min(confidence, 0.35);
  } else if (confidence < env.guardrailLowConfidence) {
    guardrail = "not_found";
    answer = "Not found in document.";
  } else if (confidence < env.guardrailCautionConfidence) {
    guardrail = "caution";
    answer = `${answer}\n\nCaution: This answer has moderate confidence.`;
  }

  return {
    document_id: params.documentIds[0] ?? "",
    document_ids: params.documentIds,
    answer,
    confidence: roundTo(confidence),
    guardrail,
    rewritten_query: rewrittenQuery,
    sources: gatheredSources,
  };
}
