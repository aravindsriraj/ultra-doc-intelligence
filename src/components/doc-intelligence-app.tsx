"use client";

import { Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { useCopilotReadable, useRenderToolCall } from "@copilotkit/react-core";

import { AskResponse, ExtractResponse, IndexedDocument, UploadResponse } from "@/lib/types";

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  return "An unexpected error occurred.";
}

function MultiSelectDropdown(props: {
  title: string;
  selectedIds: string[];
  indexedDocuments: IndexedDocument[];
  onToggle: (id: string) => void;
}) {
  return (
    <details className="group rounded-lg border border-[var(--brand-ink)]/25 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm text-[var(--brand-ink)]">
        <span>
          {props.selectedIds.length > 0
            ? `${props.selectedIds.length} document(s) selected`
            : `Select document(s) for ${props.title}`}
        </span>
        <span className="text-xs transition group-open:rotate-180">▾</span>
      </summary>

      <div className="max-h-56 space-y-2 overflow-auto border-t border-[var(--brand-ink)]/15 p-2">
        {props.indexedDocuments.length > 0 ? (
          props.indexedDocuments.map((doc) => (
            <label
              key={doc.document_id}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--brand-ink)]/10 px-2 py-2 text-sm hover:bg-[var(--panel)]"
            >
              <input
                type="checkbox"
                checked={props.selectedIds.includes(doc.document_id)}
                onChange={() => props.onToggle(doc.document_id)}
                className="mt-1"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{doc.file_name}</span>
                <span className="truncate text-xs text-[var(--muted-ink)]">{doc.document_id}</span>
              </span>
            </label>
          ))
        ) : (
          <p className="px-1 py-2 text-sm text-[var(--muted-ink)]">No indexed documents yet.</p>
        )}
      </div>
    </details>
  );
}

function ToolRenderBindings() {
  useRenderToolCall({
    name: "ask_document",
    description: "Render question answering results for document queries",
    parameters: [
      {
        name: "question",
        type: "string",
        description: "Question asked by the user",
        required: true,
      },
      {
        name: "document_ids",
        type: "string[]",
        description: "Optional list of document ids for multi-document retrieval",
        required: false,
      },
    ],
    render: ({ status, args, result }) => {
      if (status !== "complete") {
        return (
          <div className="rounded-md border border-dashed border-[var(--brand-ink)]/35 bg-white/70 p-3 text-sm text-[var(--muted-ink)]">
            Searching selected document(s) for: <span className="font-medium text-[var(--brand-ink)]">{args.question}</span>
          </div>
        );
      }

      const askResult = result as Partial<AskResponse> & { error?: string };
      if (askResult.error) {
        return <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{askResult.error}</div>;
      }

      return (
        <div className="rounded-md border border-[var(--brand)]/30 bg-[var(--card)] p-3 text-sm text-[var(--brand-ink)]">
          <div className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--muted-ink)]">Answer</div>
          <div className="mb-2 whitespace-pre-wrap">{askResult.answer}</div>
          <div className="text-xs text-[var(--muted-ink)]">
            Confidence: {askResult.confidence ?? 0} • Guardrail: {askResult.guardrail ?? "unknown"}
          </div>
        </div>
      );
    },
  });

  useRenderToolCall({
    name: "extract_shipment",
    description: "Render structured shipment extraction output",
    parameters: [
      {
        name: "document_ids",
        type: "string[]",
        description: "Optional list of document ids for multi-document extraction",
        required: false,
      },
    ],
    render: ({ status, result }) => {
      if (status !== "complete") {
        return (
          <div className="rounded-md border border-dashed border-[var(--brand-ink)]/35 bg-white/70 p-3 text-sm text-[var(--muted-ink)]">
            Extracting shipment fields from selected document(s)...
          </div>
        );
      }

      const extractResult = result as Partial<ExtractResponse> & { error?: string };
      if (extractResult.error) {
        return <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{extractResult.error}</div>;
      }

      const first = extractResult.results?.[0];
      return (
        <div className="rounded-md border border-[var(--accent)]/35 bg-[var(--card)] p-3 text-sm text-[var(--brand-ink)]">
          <div className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--muted-ink)]">Structured Extraction</div>
          <div className="mb-2 text-xs text-[var(--muted-ink)]">Documents extracted: {extractResult.total ?? 0}</div>
          {first ? (
            <>
              <div className="mb-2 text-xs text-[var(--muted-ink)]">
                {first.file_name} • {first.document_id} • confidence {first.confidence}
              </div>
              <pre className="max-h-56 overflow-auto rounded-md bg-[var(--panel)] p-2 text-xs">{prettyJson(first.extraction)}</pre>
            </>
          ) : null}
        </div>
      );
    },
  });

  useRenderToolCall({
    name: "get_latest_document",
    description: "Render the latest uploaded document metadata",
    render: ({ status, result }) => {
      if (status !== "complete") {
        return (
          <div className="rounded-md border border-dashed border-[var(--brand-ink)]/35 bg-white/70 p-3 text-sm text-[var(--muted-ink)]">
            Looking up latest document...
          </div>
        );
      }

      return (
        <pre className="max-h-56 overflow-auto rounded-md border border-[var(--brand-ink)]/20 bg-[var(--panel)] p-3 text-xs text-[var(--brand-ink)]">
          {prettyJson(result)}
        </pre>
      );
    },
  });

  return null;
}

export function DocIntelligenceApp() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedAskDocumentIds, setSelectedAskDocumentIds] = useState<string[]>([]);
  const [selectedExtractDocumentIds, setSelectedExtractDocumentIds] = useState<string[]>([]);
  const [question, setQuestion] = useState("");

  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);

  const [indexedDocuments, setIndexedDocuments] = useState<IndexedDocument[]>([]);
  const [latestDocumentId, setLatestDocumentId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [extractResult, setExtractResult] = useState<ExtractResponse | null>(null);
  const [extractPage, setExtractPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const indexedById = useMemo(
    () => new Map(indexedDocuments.map((doc) => [doc.document_id, doc])),
    [indexedDocuments],
  );

  const extractionCount = extractResult?.results.length ?? 0;
  const extractionPageIndex = extractionCount === 0 ? 0 : Math.min(extractPage, extractionCount - 1);
  const extractionItem = extractionCount > 0 ? extractResult?.results[extractionPageIndex] : null;

  const readableState = useMemo(
    () => ({
      latest_document_id: latestDocumentId,
      selected_ask_document_ids: selectedAskDocumentIds,
      selected_extract_document_ids: selectedExtractDocumentIds,
      indexed_document_count: indexedDocuments.length,
      latest_upload: uploadResult,
      latest_qa: askResult
        ? {
            document_id: askResult.document_id,
            document_ids: askResult.document_ids,
            confidence: askResult.confidence,
            guardrail: askResult.guardrail,
            answer_preview: askResult.answer.slice(0, 220),
          }
        : null,
      latest_extraction: extractResult
        ? {
            total: extractResult.total,
            current_page: extractionPageIndex + 1,
          }
        : null,
    }),
    [
      latestDocumentId,
      selectedAskDocumentIds,
      selectedExtractDocumentIds,
      indexedDocuments.length,
      uploadResult,
      askResult,
      extractResult,
      extractionPageIndex,
    ],
  );

  useCopilotReadable(
    {
      description:
        "Current app state: indexed documents, selected ask/extraction documents, and latest ask/extract outcomes.",
      value: readableState,
    },
    [readableState],
  );

  function toggleSelectedDocument(
    documentId: string,
    setter: Dispatch<SetStateAction<string[]>>,
  ) {
    setter((previous) => {
      if (previous.includes(documentId)) {
        return previous.filter((id) => id !== documentId);
      }
      return [...previous, documentId];
    });
  }

  const loadIndexedDocuments = useCallback(async () => {
    setLoadingDocuments(true);
    try {
      const response = await fetch("/documents", { method: "GET" });
      const data = (await response.json()) as { documents?: IndexedDocument[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to fetch indexed documents.");
      }

      const docs = data.documents ?? [];
      setIndexedDocuments(docs);

      setSelectedAskDocumentIds((previous) => previous.filter((id) => docs.some((doc) => doc.document_id === id)));
      setSelectedExtractDocumentIds((previous) =>
        previous.filter((id) => docs.some((doc) => doc.document_id === id)),
      );
    } catch (documentsError) {
      setError(toErrorMessage(documentsError));
    } finally {
      setLoadingDocuments(false);
    }
  }, []);

  useEffect(() => {
    void loadIndexedDocuments();
  }, [loadIndexedDocuments]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!selectedFile) {
      setError("Select a file before uploading.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as UploadResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Upload failed.");
      }

      setUploadResult(data);
      setLatestDocumentId(data.document_id);
      setSelectedAskDocumentIds([data.document_id]);
      setSelectedExtractDocumentIds([data.document_id]);
      setAskResult(null);
      setExtractResult(null);
      setExtractPage(0);
      setSelectedFile(null);

      await loadIndexedDocuments();
    } catch (uploadError) {
      setError(toErrorMessage(uploadError));
    } finally {
      setUploading(false);
    }
  }

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!question.trim()) {
      setError("Enter a question first.");
      return;
    }

    setAsking(true);
    try {
      const response = await fetch("/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          document_ids: selectedAskDocumentIds.length > 0 ? selectedAskDocumentIds : undefined,
        }),
      });

      const data = (await response.json()) as AskResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Question answering failed.");
      }

      setAskResult(data);
      setLatestDocumentId(data.document_id);
      if (data.document_ids.length > 0) {
        setSelectedAskDocumentIds(data.document_ids);
      }
    } catch (askError) {
      setError(toErrorMessage(askError));
    } finally {
      setAsking(false);
    }
  }

  async function handleExtract() {
    setError(null);
    setExtracting(true);

    try {
      const response = await fetch("/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document_ids: selectedExtractDocumentIds.length > 0 ? selectedExtractDocumentIds : undefined,
        }),
      });

      const data = (await response.json()) as ExtractResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Extraction failed.");
      }

      setExtractResult(data);
      setExtractPage(0);
      if (data.results.length > 0) {
        setLatestDocumentId(data.results[0].document_id);
      }
    } catch (extractError) {
      setError(toErrorMessage(extractError));
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--background)] pb-16 text-[var(--brand-ink)]">
      <ToolRenderBindings />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-8 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-[var(--brand-ink)]/15 bg-[var(--card)]/80 p-6 shadow-[0_12px_30px_rgba(10,38,49,0.08)] backdrop-blur-sm">
          <div className="text-xs uppercase tracking-[0.22em] text-[var(--muted-ink)]">Ultra Doc-Intelligence</div>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Logistics RAG + Structured Extraction</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted-ink)] sm:text-base">
            Upload logistics documents, select one or many indexed docs, ask grounded questions, and run extraction.
          </p>
          <div className="mt-3 text-sm text-[var(--muted-ink)]">
            Active document: <span className="font-semibold text-[var(--brand-ink)]">{latestDocumentId ?? "none"}</span>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <section className="space-y-6">
            <form
              onSubmit={handleUpload}
              className="rounded-2xl border border-[var(--brand-ink)]/15 bg-[var(--card)]/90 p-5 shadow-[0_10px_26px_rgba(10,38,49,0.06)]"
            >
              <h2 className="text-lg font-semibold">1. Upload Document</h2>
              <p className="mt-1 text-sm text-[var(--muted-ink)]">Accepted: PDF, DOCX, TXT</p>
              <div className="mt-4 flex flex-col gap-3">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  className="rounded-lg border border-[var(--brand-ink)]/25 bg-white px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={uploading}
                  className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {uploading ? "Uploading and indexing..." : "Upload + Index"}
                </button>
              </div>
            </form>

            <form
              onSubmit={handleAsk}
              className="rounded-2xl border border-[var(--brand-ink)]/15 bg-[var(--card)]/90 p-5 shadow-[0_10px_26px_rgba(10,38,49,0.06)]"
            >
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold">2. Ask a Question</h2>
                <button
                  type="button"
                  onClick={() => void loadIndexedDocuments()}
                  className="rounded-md border border-[var(--brand-ink)]/25 px-2 py-1 text-xs text-[var(--brand-ink)] hover:bg-[var(--panel)]"
                >
                  {loadingDocuments ? "Refreshing..." : "Refresh docs"}
                </button>
              </div>

              <p className="mt-1 text-sm text-[var(--muted-ink)]">
                Select one or multiple indexed documents. If none selected, latest upload is used.
              </p>

              <div className="mt-4 space-y-3">
                <MultiSelectDropdown
                  title="question answering"
                  selectedIds={selectedAskDocumentIds}
                  indexedDocuments={indexedDocuments}
                  onToggle={(id) => toggleSelectedDocument(id, setSelectedAskDocumentIds)}
                />

                <div className="flex flex-wrap gap-2">
                  {selectedAskDocumentIds.map((id) => {
                    const doc = indexedById.get(id);
                    return (
                      <span
                        key={id}
                        className="inline-flex max-w-full items-center gap-2 rounded-full bg-[var(--panel)] px-3 py-1 text-xs text-[var(--brand-ink)]"
                      >
                        <span className="truncate">{doc?.file_name ?? "Unknown"}</span>
                        <span className="truncate text-[var(--muted-ink)]">{id}</span>
                      </span>
                    );
                  })}
                </div>

                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Where is pickup and drop for the selected docs?"
                  rows={4}
                  className="rounded-lg border border-[var(--brand-ink)]/25 bg-white px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={asking}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {asking ? "Retrieving answer..." : "Ask"}
                </button>
              </div>
            </form>

            <section className="rounded-2xl border border-[var(--brand-ink)]/15 bg-[var(--card)]/90 p-5 shadow-[0_10px_26px_rgba(10,38,49,0.06)]">
              <h2 className="text-lg font-semibold">3. Structured Extraction</h2>
              <p className="mt-1 text-sm text-[var(--muted-ink)]">
                Select one or multiple indexed documents for extraction. If none selected, latest upload is used.
              </p>

              <div className="mt-4 space-y-3">
                <MultiSelectDropdown
                  title="structured extraction"
                  selectedIds={selectedExtractDocumentIds}
                  indexedDocuments={indexedDocuments}
                  onToggle={(id) => toggleSelectedDocument(id, setSelectedExtractDocumentIds)}
                />

                <div className="flex flex-wrap gap-2">
                  {selectedExtractDocumentIds.map((id) => {
                    const doc = indexedById.get(id);
                    return (
                      <span
                        key={id}
                        className="inline-flex max-w-full items-center gap-2 rounded-full bg-[var(--panel)] px-3 py-1 text-xs text-[var(--brand-ink)]"
                      >
                        <span className="truncate">{doc?.file_name ?? "Unknown"}</span>
                        <span className="truncate text-[var(--muted-ink)]">{id}</span>
                      </span>
                    );
                  })}
                </div>

                <button
                  onClick={handleExtract}
                  disabled={extracting}
                  className="rounded-lg bg-[var(--brand-ink)] px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {extracting ? "Extracting..." : "Run Extraction"}
                </button>
              </div>
            </section>
          </section>

          <section className="space-y-6">
            <div className="rounded-2xl border border-[var(--brand-ink)]/15 bg-[var(--card)]/90 p-5 shadow-[0_10px_26px_rgba(10,38,49,0.06)]">
              <h2 className="text-lg font-semibold">Answer Output</h2>
              {askResult ? (
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <span className="font-medium">Primary document:</span> {askResult.document_id}
                  </div>
                  <div>
                    <span className="font-medium">Queried documents:</span> {askResult.document_ids.join(", ")}
                  </div>
                  <div className="rounded-lg bg-[var(--panel)] p-3 whitespace-pre-wrap">{askResult.answer}</div>
                  <div className="text-[var(--muted-ink)]">
                    Confidence: {askResult.confidence} • Guardrail: {askResult.guardrail}
                  </div>
                  <div className="text-[var(--muted-ink)]">Rewritten query: {askResult.rewritten_query}</div>
                  <div>
                    <div className="mb-2 font-medium">Supporting Sources</div>
                    <div className="max-h-72 space-y-2 overflow-auto pr-1">
                      {askResult.sources.map((source) => (
                        <div key={source.id} className="rounded-lg border border-[var(--brand-ink)]/15 bg-white p-3">
                          <div className="text-xs text-[var(--muted-ink)]">
                            {source.id} • score {source.score} • page {source.metadata.page_number} • doc {source.metadata.document_id}
                          </div>
                          <div className="mt-1 text-sm whitespace-pre-wrap">{source.text}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--muted-ink)]">No question asked yet.</p>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--brand-ink)]/15 bg-[var(--card)]/90 p-5 shadow-[0_10px_26px_rgba(10,38,49,0.06)]">
              <h2 className="text-lg font-semibold">Extraction Output</h2>
              {extractionItem ? (
                <div className="mt-3 space-y-3">
                  <div className="text-sm text-[var(--muted-ink)]">
                    <span className="font-medium text-[var(--brand-ink)]">Document Name:</span> {extractionItem.file_name}
                  </div>
                  <div className="text-sm text-[var(--muted-ink)]">
                    <span className="font-medium text-[var(--brand-ink)]">Document ID:</span> {extractionItem.document_id}
                  </div>
                  <div className="text-sm text-[var(--muted-ink)]">
                    <span className="font-medium text-[var(--brand-ink)]">Confidence:</span> {extractionItem.confidence}
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-[var(--brand-ink)]/15 bg-white px-3 py-2 text-xs text-[var(--muted-ink)]">
                    <button
                      type="button"
                      onClick={() => setExtractPage((page) => Math.max(0, page - 1))}
                      disabled={extractionPageIndex <= 0}
                      className="rounded border border-[var(--brand-ink)]/20 px-2 py-1 disabled:opacity-50"
                    >
                      Prev
                    </button>
                    <span>
                      Page {extractionPageIndex + 1} of {extractResult?.total ?? 1}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setExtractPage((page) =>
                          Math.min((extractResult?.total ?? 1) - 1, page + 1),
                        )
                      }
                      disabled={extractionPageIndex >= (extractResult?.total ?? 1) - 1}
                      className="rounded border border-[var(--brand-ink)]/20 px-2 py-1 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>

                  <pre className="max-h-80 overflow-auto rounded-lg bg-[var(--panel)] p-3 text-xs">
                    {prettyJson(extractionItem.extraction)}
                  </pre>
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--muted-ink)]">No extraction run yet.</p>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--brand-ink)]/15 bg-[var(--card)]/90 p-5 shadow-[0_10px_26px_rgba(10,38,49,0.06)]">
              <h2 className="text-lg font-semibold">Indexed Documents</h2>
              {indexedDocuments.length > 0 ? (
                <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1 text-sm">
                  {indexedDocuments.map((doc) => (
                    <div key={doc.document_id} className="rounded-lg border border-[var(--brand-ink)]/15 bg-white p-3">
                      <div className="font-medium">{doc.file_name}</div>
                      <div className="text-xs text-[var(--muted-ink)]">{doc.document_id}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-[var(--muted-ink)]">No indexed documents yet.</p>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--brand-ink)]/15 bg-[var(--card)]/90 p-5 shadow-[0_10px_26px_rgba(10,38,49,0.06)]">
              <h2 className="text-lg font-semibold">Upload Summary</h2>
              {uploadResult ? (
                <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-[var(--panel)] p-3 text-xs">
                  {prettyJson(uploadResult)}
                </pre>
              ) : (
                <p className="mt-3 text-sm text-[var(--muted-ink)]">No document uploaded yet.</p>
              )}
            </div>
          </section>
        </div>
      </div>

      <CopilotSidebar
        defaultOpen={false}
        labels={{
          title: "Logistics Copilot",
          initial: "Ask me about the uploaded document.",
        }}
        instructions={
          "You are a logistics document intelligence copilot. Use ask_document for grounded Q&A and extract_shipment for schema extraction. You may pass document_ids for multi-document querying and extraction. Never invent values not present in tool output."
        }
      />
    </div>
  );
}
