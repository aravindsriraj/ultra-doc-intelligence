import { Pinecone } from "@pinecone-database/pinecone";

import { env, requireEnv } from "@/lib/env";
import { embedDenseBatch } from "@/lib/vector/pinecone-hybrid";

export type DocumentRegistryItem = {
  documentId: string;
  fileName: string;
  uploadedAt: string;
  namespace: string;
  tenantId: string;
  chunkCount: number;
};

type RegistryMetadata = {
  record_type: string;
  document_id: string;
  file_name: string;
  uploaded_at: string;
  namespace: string;
  tenant_id: string;
  chunk_count: number;
};

const REGISTRY_ID_PREFIX = "docmeta#";

function getRegistryNamespace(): string {
  return `${env.pineconeNamespace}:registry`;
}

function toRegistryId(documentId: string): string {
  return `${REGISTRY_ID_PREFIX}${documentId}`;
}

function fromRegistryId(registryId: string): string {
  return registryId.startsWith(REGISTRY_ID_PREFIX) ? registryId.slice(REGISTRY_ID_PREFIX.length) : registryId;
}

function getIndex() {
  requireEnv("pineconeApiKey", "pineconeIndexName");

  const pinecone = new Pinecone({ apiKey: env.pineconeApiKey as string });
  if (env.pineconeIndexHost) {
    return pinecone.index<RegistryMetadata>({ host: env.pineconeIndexHost });
  }

  return pinecone.index<RegistryMetadata>({ name: env.pineconeIndexName });
}

function toRegistryItem(metadata: RegistryMetadata | null): DocumentRegistryItem | null {
  if (!metadata) return null;

  const documentId = String(metadata.document_id ?? "").trim();
  const fileName = String(metadata.file_name ?? "").trim();
  const uploadedAt = String(metadata.uploaded_at ?? "").trim();
  const namespace = String(metadata.namespace ?? "").trim();
  const tenantId = String(metadata.tenant_id ?? "").trim();
  const chunkCount = Number(metadata.chunk_count ?? 0);

  if (!documentId || !fileName || !uploadedAt || !namespace || !tenantId) return null;

  return {
    documentId,
    fileName,
    uploadedAt,
    namespace,
    tenantId,
    chunkCount: Number.isFinite(chunkCount) ? chunkCount : 0,
  };
}

async function listRegistryIds(namespace: string): Promise<string[]> {
  const index = getIndex();
  const ids: string[] = [];
  let paginationToken: string | undefined;

  do {
    const page = await index.listPaginated({
      namespace,
      prefix: REGISTRY_ID_PREFIX,
      ...(paginationToken ? { paginationToken } : {}),
    });

    const pageIds = (page.vectors ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    ids.push(...pageIds);
    paginationToken = page.pagination?.next;
  } while (paginationToken);

  return ids;
}

async function fetchRegistryItemsByIds(registryIds: string[], namespace: string): Promise<DocumentRegistryItem[]> {
  if (registryIds.length === 0) return [];

  const index = getIndex();
  const items: DocumentRegistryItem[] = [];

  for (let i = 0; i < registryIds.length; i += 100) {
    const batch = registryIds.slice(i, i + 100);
    const fetched = await index.fetch({
      namespace,
      ids: batch,
    });

    for (const [id, record] of Object.entries(fetched.records ?? {})) {
      const metadata = (record.metadata ?? null) as RegistryMetadata | null;
      const mapped = toRegistryItem(metadata);

      if (mapped) {
        const fallbackDocumentId = mapped.documentId || fromRegistryId(id);
        items.push({
          ...mapped,
          documentId: fallbackDocumentId,
        });
      }
    }
  }

  return items;
}

export async function getLatestDocumentId(): Promise<string | null> {
  const items = await listRegistryItems();
  return items[0]?.documentId ?? null;
}

export async function getRegistryItem(documentId: string): Promise<DocumentRegistryItem | null> {
  const index = getIndex();
  const namespace = getRegistryNamespace();
  const id = toRegistryId(documentId);

  const fetched = await index.fetch({
    namespace,
    ids: [id],
  });

  const record = fetched.records?.[id];
  const metadata = (record?.metadata ?? null) as RegistryMetadata | null;
  const mapped = toRegistryItem(metadata);

  if (!mapped) return null;
  return {
    ...mapped,
    documentId,
  };
}

export async function listRegistryItems(): Promise<DocumentRegistryItem[]> {
  const namespace = getRegistryNamespace();
  const ids = await listRegistryIds(namespace);
  const items = await fetchRegistryItemsByIds(ids, namespace);

  return items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function saveRegistryItem(item: DocumentRegistryItem): Promise<void> {
  const namespace = getRegistryNamespace();
  const index = getIndex();
  const id = toRegistryId(item.documentId);

  const embeddingInput = `document_id:${item.documentId}\nfile_name:${item.fileName}\nuploaded_at:${item.uploadedAt}`;
  const embedding = (await embedDenseBatch([embeddingInput]))[0];

  await index.upsert({
    namespace,
    records: [
      {
        id,
        values: embedding,
        metadata: {
          record_type: "document_registry",
          document_id: item.documentId,
          file_name: item.fileName,
          uploaded_at: item.uploadedAt,
          namespace: item.namespace,
          tenant_id: item.tenantId,
          chunk_count: item.chunkCount,
        },
      },
    ],
  });
}
