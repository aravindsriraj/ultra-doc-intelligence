# AGENTS.md

## Mission
Build reliable document-intelligence apps and AI agents in this repository, with a default focus on RAG.

## Required Sources
Always use these sources first before implementing:

1. `langchain-docs` MCP server
Use for LangChain/LangGraph agent and RAG architecture patterns.
Primary topics:
- `Build a RAG agent with LangChain` (Python or JS)
- `Build a custom RAG agent with LangGraph`
- `Custom RAG workflow` (rewrite -> retrieve -> agent with `StateGraph`)

2. `CopilotKit-MCP` MCP server
Use for generative UI and agent-to-frontend interaction patterns.
Primary topics:
- `Generative UI`
- `Tool-based Generative UI`
- `Chat with an Agent`
- hooks such as `useCopilotAction`, `useRenderToolCall`, `useCoAgent`, `useCoAgentStateRender`, `useCopilotReadable`, `useHumanInTheLoop`

3. `llama_index_docs` MCP server
Use for LlamaIndex + LlamaCloud + LlamaParse ingestion and parsing flows.
Primary topics:
- `/python/cloud/llamacloud/getting_started`
- `/python/cloud/llamacloud/guides/framework_integration`
- `/python/cloud/llamacloud/retrieval/basic`
- `/python/cloud/llamaparse/getting_started`

4. Local Pinecone reference
Read `pinecone-documentation.txt` for Pinecone-specific RAG implementation details.

## Default Stack and Flow
Use this order unless the task explicitly requires something else:

1. Parse documents with LlamaParse / LlamaCloud.
2. Chunk + store searchable records in Pinecone.
3. Build retrieval + orchestration with LangChain/LangGraph.
4. Build chat + generative UI with CopilotKit.

## Implementation Guardrails

### LangChain / LangGraph
- Start simple:
  - Agentic RAG for flexible tool use.
  - 2-step RAG for low-latency predictable retrieval-first flows.
- For custom workflows, prefer graph nodes:
  - `rewrite` (model node)
  - `retrieve` (deterministic retrieval node)
  - `agent` (reasoning/tool node)
- Expose retrieval as a tool when using agentic RAG (e.g., `@tool` / `createRetrieverTool`).
- Keep retrieved source docs accessible in state when citations/metadata are needed.

### CopilotKit Generative UI
- Prefer CopilotKit UI primitives (`CopilotChat`, `CopilotSidebar`, `CopilotPopup`) unless headless is needed.
- Use render hooks for rich UI in chat:
  - `useRenderToolCall` for render-only tool visualization.
  - `useCopilotAction` / `useFrontendTool` for frontend-callable tools.
  - `useHumanInTheLoop` for blocking approval/input steps.
- Important: when rendering backend tool calls, frontend action name must match backend tool name.
- Use shared state hooks:
  - `useCopilotReadable` to expose app context.
  - `useCoAgent` / `useCoAgentStateRender` to read and render agent state in real time.

### LlamaIndex Cloud + LlamaParse
- Use `LLAMA_CLOUD_API_KEY`.
- For parsing pipeline:
  1. Upload file (`files.create(..., purpose="parse")`).
  2. Run parse job (`parsing.parse`) with explicit `tier` and `version`.
  3. Request needed outputs (`expand`: text/markdown/items/images metadata).
- Tier guidance:
  - `agentic_plus` for highest fidelity complex layouts/tables.
  - `agentic` for balanced quality.
  - `fast` for low-cost spatial text workflows.
- For retrieval integration, use `LlamaCloudIndex`:
  - `from_documents(...)` for local/framework-driven ingestion.
  - `LlamaCloudIndex(index_name, project_name=...)` for existing cloud index.
  - then `as_retriever()`, `as_query_engine()`, or `as_chat_engine()`.

### Pinecone (from `pinecone-documentation.txt`)
- Prefer serverless dense index with integrated embedding for text-first RAG.
- Standard integrated model pattern:
  - `create_index_for_model(...)`
  - `embed.model = "llama-text-embed-v2"`
  - `embed.field_map` should map input text field (for example `chunk_text`).
- Use namespaces intentionally:
  - one namespace per tenant is preferred for isolation, speed, and cost.
  - avoid high-cardinality user filters as a substitute for namespaces.
- Use structured IDs for chunks, e.g. `document1#chunk1`.
- Store useful metadata for filtering and traceability (`document_id`, `chunk_number`, `document_title`, `document_url`, timestamps, category).
- Metadata expectations:
  - flat JSON values (no nested objects for metadata payloads).
  - supported value types include string/number/boolean/list-of-strings.
- Query patterns:
  - semantic search with text inputs on integrated indexes.
  - metadata filters for document-scoped retrieval.
  - reranking (`bge-reranker-v2-m3`) when result quality matters.
- Operational notes:
  - Pinecone is eventually consistent; add retry/small delay after writes.
  - for very large ingestion (10M+ records), prefer import over upsert.
  - integrated embedding indexes do not support updating/importing with text.

## Quality Checklist (RAG Tasks)
Before finalizing any RAG feature, verify:

1. Parsing quality is validated on at least one representative document.
2. Chunk schema includes stable IDs + filterable metadata.
3. Namespace strategy is tenant-safe and cost-aware.
4. Retrieval returns grounded context for target queries.
5. Agent prompt/tool policy prevents hallucinated citations.
6. CopilotKit UI shows useful tool/state progress to users.
