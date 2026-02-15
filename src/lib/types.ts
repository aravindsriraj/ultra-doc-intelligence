export type ShipmentExtraction = {
  shipment_id: string | null;
  shipper: string | null;
  consignee: string | null;
  pickup_datetime: string | null;
  delivery_datetime: string | null;
  equipment_type: string | null;
  mode: string | null;
  rate: number | null;
  currency: string | null;
  weight: number | null;
  carrier_name: string | null;
};

export type DocumentMetadata = {
  document_id: string;
  tenant_id: string;
  document_title: string;
  source_file_name: string;
  uploaded_at: string;
  page_number: number;
  chunk_number: number;
  chunk_text: string;
};

export type ParsedDocumentPayload = {
  documentId: string;
  tenantId: string;
  fileName: string;
  uploadedAt: string;
  textFull: string;
  markdownFull: string;
  pageTexts: Array<{ pageNumber: number; text: string }>;
};

export type ChunkRecord = {
  id: string;
  text: string;
  metadata: DocumentMetadata;
};

export type SourceSnippet = {
  id: string;
  score: number;
  text: string;
  metadata: DocumentMetadata;
};

export type AskResponse = {
  document_id: string;
  document_ids: string[];
  answer: string;
  confidence: number;
  guardrail: "ok" | "caution" | "not_found";
  rewritten_query: string;
  sources: SourceSnippet[];
};

export type UploadResponse = {
  document_id: string;
  file_name: string;
  chunk_count: number;
  namespace: string;
  uploaded_at: string;
};

export type ExtractedDocumentResult = {
  document_id: string;
  file_name: string;
  extraction: ShipmentExtraction;
  confidence: number;
};

export type ExtractResponse = {
  results: ExtractedDocumentResult[];
  total: number;
};

export type IndexedDocument = {
  document_id: string;
  file_name: string;
  uploaded_at: string;
  namespace: string;
  chunk_count: number;
};
