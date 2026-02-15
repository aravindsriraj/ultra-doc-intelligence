# Ultra Doc-Intelligence

POC AI system for logistics document intelligence in a Transportation Management System (TMS) workflow.

Users can upload logistics documents, ask grounded questions, and run structured extraction with confidence and guardrails.

## Hosted App

- Vercel: `https://doc-intelligence-alpha.vercel.app`

## Overview

Logistics teams work with unstructured files like Rate Confirmations, BOLs, shipment instructions, and invoices.  
This project provides an end-to-end RAG assistant that:

- ingests `PDF`, `DOCX`, `TXT`
- supports grounded Q&A over one or multiple indexed documents
- returns answer + supporting sources + confidence + guardrail status
- extracts required shipment fields as JSON (null-safe)
- includes a lightweight reviewer UI and Copilot sidebar

---

## Architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│                         Next.js Single-Page UI                    │
│  - Upload                                                         │
│  - Multi-select ask (document_ids[])                              │
│  - Multi-select extract (document_ids[]) + pagination             │
│  - CopilotSidebar + tool rendering                                │
└───────────────────────────────┬────────────────────────────────────┘
                                │
                    Next.js App Router APIs
                                │
  ┌─────────────────────────────┼─────────────────────────────┐
  │                             │                             │
POST /upload                POST /ask                    POST /extract
  │                             │                             │
LlamaCloud parse             LangChain ReAct agent         LangChain structured extraction
  │                          (tool-based retrieval)         (strict schema)
Chunking + metadata              │                             │
  │                          Hybrid retrieval             Fetch all doc chunks
Dense embedding (OpenAI)         │                          from Pinecone
Sparse embedding (Pinecone)      │                             │
  │                          Guardrails + confidence       Per-doc extraction + confidence
Upsert chunks to Pinecone        │                             │
Save registry metadata           └──────────────┬──────────────┘
in Pinecone (serverless-safe)                   │
                                                v
                                          JSON response
```

### Key implementation files

- UI
  - `src/components/doc-intelligence-app.tsx`
- API routes
  - `src/app/upload/route.ts`
  - `src/app/ask/route.ts`
  - `src/app/extract/route.ts`
  - `src/app/documents/route.ts`
  - `src/app/api/copilotkit/route.ts`
- Service orchestration
  - `src/lib/services/doc-intelligence.ts`
- RAG and retrieval
  - `src/lib/rag/workflow.ts`
  - `src/lib/vector/pinecone-hybrid.ts`
- Parsing and extraction
  - `src/lib/parsing/llama-parse.ts`
  - `src/lib/extraction/shipment.ts`
- Registry and document listing
  - `src/lib/storage/registry.ts`

---

## Tech Stack

- Framework: Next.js (App Router), React, TypeScript
- AI orchestration: LangChain JS
- Agent pattern: ReAct-style retrieval agent (`createAgent` + retrieval tool)
- Parsing: LlamaCloud / LlamaParse
- Vector DB: Pinecone (hybrid dense + sparse retrieval)
- Dense embeddings: OpenAI `text-embedding-3-large`
- Sparse embeddings: Pinecone `pinecone-sparse-english-v0`
- UI assistant layer: CopilotKit (`CopilotSidebar`, `useRenderToolCall`, `useCopilotReadable`)

---

## How It Works

### 1) Upload & Index (`POST /upload`)

1. Accept file upload (`PDF`, `DOCX`, `TXT`).
2. Parse content:
   - `TXT`: read directly
   - `PDF` / `DOCX`: parse with LlamaCloud
3. Chunk text (page-aware, overlapping).
4. Generate embeddings:
   - dense via OpenAI
   - sparse via Pinecone inference
5. Upsert chunk vectors + metadata into Pinecone document namespace.
6. Save document registry record in Pinecone registry namespace (`docmeta#<document_id>`).

### 2) Ask (`POST /ask`)

1. Accept `question` and optional `document_ids[]` / `document_id`.
2. Resolve scope:
   - selected docs if provided
   - otherwise latest uploaded doc from registry
3. Rewrite user question for retrieval.
4. Run ReAct agent with `retrieve_document_chunks` tool.
5. Agent can call retrieval multiple times for complex/multi-part questions.
6. Merge and dedupe retrieved chunks across calls.
7. Apply guardrails and compute confidence.
8. Return grounded answer + source snippets + confidence + guardrail status.

### 3) Structured Extraction (`POST /extract`)

1. Accept optional `document_ids[]` / `document_id`.
2. Resolve selected docs (or latest).
3. For each document:
   - fetch all indexed chunks from Pinecone (`fetchByMetadata`)
   - run strict schema extraction chain
   - compute extraction confidence
4. Return `results[]` + `total`.

---

## Chunking Strategy

Implemented in `src/lib/chunking.ts`.

- Paragraph-first splitting on blank lines.
- Page-aware chunking (keeps page traceability).
- Defaults:
  - `targetChars = 1200`
  - `overlapChars = 180`
- Stable chunk IDs:
  - `documentId#p{pageNumber}c{pageChunkIndex}`
- Metadata stored per chunk:
  - `document_id`, `tenant_id`, `document_title`, `source_file_name`
  - `uploaded_at`, `page_number`, `chunk_number`, `chunk_text`

Why this helps:
- Good context density for logistics docs with tabular/sectioned text.
- Overlap preserves entities and rate/location info across boundaries.
- Page metadata improves explainability and citations.

---

## Retrieval Method

Implemented in `src/lib/vector/pinecone-hybrid.ts`.

### Hybrid retrieval

- Dense query embedding from OpenAI.
- Sparse query embedding from Pinecone model.
- Weighted fusion:
  - dense vector scaled by `alpha`
  - sparse vector scaled by `1 - alpha`
- `alpha` is configurable (`HYBRID_ALPHA`, default `0.5`).

### Document filtering

- Single-document retrieval:
  - `document_id = <id>`
- Multi-document retrieval:
  - `document_id IN [id1, id2, ...]`

### Retrieval usage in agent

- Retrieval is exposed as a tool: `retrieve_document_chunks`.
- Agent can iteratively refine queries and call tool multiple times.
- Sources are merged by chunk ID, keeping highest score per chunk.

---

## Guardrails Approach

Implemented in `src/lib/rag/workflow.ts`.

### Guardrail 1: retrieval threshold gate

If no retrieved sources OR top similarity score is below `GUARDRAIL_MIN_TOP_SCORE`, response becomes:
- `answer = "Not found in document."`
- `guardrail = "not_found"`

### Guardrail 2: grounding gate

Agent returns structured flags (`grounded`, `not_found`).  
If answer is not grounded:
- force `Not found in document.`

### Guardrail 3: confidence policy gate

After confidence is computed:
- if `< GUARDRAIL_LOW_CONFIDENCE` => `not_found`
- if `< GUARDRAIL_CAUTION_CONFIDENCE` => `caution`
- otherwise => `ok`

This creates explicit fallback behavior instead of hallucinating.

---

## Confidence Scoring Method

Implemented in `src/lib/rag/workflow.ts` for Q&A.

`confidence = 0.6 * retrievalSignal + 0.25 * agreementSignal + 0.15 * citationSignal`

Where:
- `retrievalSignal = clamp(topScore / 2.5, 0, 1)`
- `agreementSignal = clamp(secondScore / topScore, 0, 1)` (when top score > 0)
- `citationSignal = validCitedChunkIds / totalCitedChunkIds` (or 0 if none)

This measures:
- relevance strength
- agreement among top retrieved chunks
- citation integrity against retrieved evidence

### Extraction confidence

Implemented in `src/lib/extraction/shipment.ts`:

`extraction_confidence = 0.65 * model_self_assessed_confidence + 0.35 * field_completeness`

Where field completeness is the ratio of non-null fields in the required schema.

---

## Required Structured Extraction Schema

Returned with nulls when missing:

- `shipment_id`
- `shipper`
- `consignee`
- `pickup_datetime`
- `delivery_datetime`
- `equipment_type`
- `mode`
- `rate`
- `currency`
- `weight`
- `carrier_name`

---

## API Endpoints

### `POST /upload`

`multipart/form-data`

- `file` (required)
- `tenant_id` (optional)

Response example:

```json
{
  "document_id": "uuid",
  "file_name": "LD53657-Carrier-RC.pdf",
  "chunk_count": 4,
  "namespace": "tenant-demo:tenant-demo",
  "uploaded_at": "2026-02-15T12:39:46.744Z"
}
```

### `POST /ask`

Request example:

```json
{
  "question": "What is the carrier rate?",
  "document_ids": ["8b74d5cd-ad1d-49c6-ad08-1044cc3b3fae"]
}
```

Response includes:
- `answer`
- `confidence`
- `guardrail` (`ok | caution | not_found`)
- `rewritten_query`
- `sources[]` with chunk metadata

### `POST /extract`

Request example:

```json
{
  "document_ids": ["8b74d5cd-ad1d-49c6-ad08-1044cc3b3fae"]
}
```

Response example:

```json
{
  "results": [
    {
      "document_id": "8b74d5cd-ad1d-49c6-ad08-1044cc3b3fae",
      "file_name": "LD53657-Carrier-RC.pdf",
      "confidence": 0.9675,
      "extraction": {
        "shipment_id": "LD53657",
        "shipper": "AAA",
        "consignee": "xyz",
        "pickup_datetime": "02-08-2026 09:00 - 17:00",
        "delivery_datetime": "02-08-2026 09:00 - 17:00",
        "equipment_type": "Flatbed",
        "mode": "FTL",
        "rate": 400,
        "currency": "USD",
        "weight": 56000,
        "carrier_name": "SWIFT SHIFT LOGISTICS LLC"
      }
    }
  ],
  "total": 1
}
```

### `GET /documents`

Returns indexed document list for UI dropdowns.

### `POST /api/copilotkit`

CopilotKit runtime endpoint exposing:
- `ask_document`
- `extract_shipment`
- `get_latest_document`

---

## Minimal UI (Reviewer Workflow)

The UI supports:

- Upload document
- Ask question against selected one or many indexed docs
- View answer, sources, confidence, guardrail
- Run structured extraction on selected one or many docs
- View extraction output with pagination (includes doc name + doc id)
- Use Copilot sidebar for tool-based interactions

---

## Setup (Local)

### Prerequisites

- Node.js 20+
- npm
- OpenAI API key
- LlamaCloud API key
- Pinecone index and key

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env.local
```

Required env vars:

- `OPENAI_API_KEY`
- `LLAMA_CLOUD_API_KEY`
- `PINECONE_API_KEY`
- `PINECONE_INDEX_NAME` (or `PINECONE_INDEX_HOST`)

Important defaults:

- `OPENAI_CHAT_MODEL=gpt-4.1-mini`
- `OPENAI_EMBEDDING_MODEL=text-embedding-3-large`
- `PINECONE_SPARSE_MODEL=pinecone-sparse-english-v0`
- `HYBRID_ALPHA=0.5`
- `GUARDRAIL_MIN_TOP_SCORE=0.85`
- `GUARDRAIL_LOW_CONFIDENCE=0.4`
- `GUARDRAIL_CAUTION_CONFIDENCE=0.6`

Run:

```bash
npm run dev
```

Quality checks:

```bash
npm run lint
npm run build
```

---

## Pinecone Index Configuration

Recommended for this project:

- Vector type: `Dense`
- Metric: `dotproduct`
- Dimension:
  - `3072` for default `text-embedding-3-large`
  - or set `OPENAI_EMBEDDING_DIMENSIONS` to match a reduced-dimension index
- Deployment: `Serverless`

Namespace strategy:

- Document chunks: `${PINECONE_NAMESPACE}:${tenantId}`
- Registry metadata: `${PINECONE_NAMESPACE}:registry`

---

## Failure Cases

- Low-quality scans / OCR noise can reduce retrieval quality.
- Extremely dense or irregular tables can degrade parser fidelity.
- If selected docs are from different namespaces, request is rejected.
- Pinecone eventual consistency can briefly affect read-after-write.
- Ambiguous user questions can trigger lower confidence and guardrail fallback.
- Extraction may miss values when fields are implied but not explicitly present.

---

## Improvement Ideas

- Add reranker stage (e.g., after hybrid retrieval, before answer synthesis).
- Add evidence spans per extracted field.
- Add citation requirement checks for every factual sentence in answer.
- Add test harness with golden QA and extraction datasets.
- Add tenant auth and namespace isolation by authenticated org/user.
- Add asynchronous ingestion queue for large documents/batch uploads.
- Add query decomposition node before agent tool calls for complex questions.
- Add automatic threshold calibration from evaluation data.

---

## Practical AI Engineering Notes

- ReAct retrieval agent is used because logistics questions are often multi-part.
- Hybrid retrieval improves exact-match fields (IDs/rates/locations) and semantic recall.
- Guardrails favor abstention over hallucination.
- Registry persistence was implemented in Pinecone to stay serverless-compatible on Vercel.

---

## Security Note

- Never commit secrets in source control.
- Rotate keys immediately if shared in logs/chats/history.

