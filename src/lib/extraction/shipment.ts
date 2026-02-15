import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import { env, requireEnv } from "@/lib/env";
import { ShipmentExtraction } from "@/lib/types";

const ExtractionSchema = z.object({
  shipment_id: z.string().nullable(),
  shipper: z.string().nullable(),
  consignee: z.string().nullable(),
  pickup_datetime: z.string().nullable(),
  delivery_datetime: z.string().nullable(),
  equipment_type: z.string().nullable(),
  mode: z.string().nullable(),
  rate: z.union([z.number(), z.string()]).nullable(),
  currency: z.string().nullable(),
  weight: z.union([z.number(), z.string()]).nullable(),
  carrier_name: z.string().nullable(),
  self_assessed_confidence: z.number().min(0).max(1),
});

function toNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const cleaned = value.replace(/[^0-9.-]/g, "").trim();
  if (cleaned.length === 0) return null;

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundTo(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function computeExtractionConfidence(extraction: ShipmentExtraction, modelConfidence: number): number {
  const fields = Object.values(extraction);
  const present = fields.filter((value) => value !== null).length;
  const completeness = present / fields.length;

  return roundTo(0.65 * modelConfidence + 0.35 * completeness);
}

export async function extractShipmentData(params: {
  text: string;
  fileName?: string;
}): Promise<{ extraction: ShipmentExtraction; confidence: number }> {
  requireEnv("openAiApiKey");

  const llm = new ChatOpenAI({
    apiKey: env.openAiApiKey,
    model: env.openAiChatModel,
    temperature: 0,
  }).withStructuredOutput(ExtractionSchema, {
    name: "extract_shipment_data",
    strict: true,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Extract shipment data from a logistics document. Return null for missing fields. Use ISO-8601 datetime when explicitly present; otherwise keep original date-time text. Keep currency as a 3-letter code when available.",
    ],
    [
      "human",
      "File name: {fileName}\n\nDocument:\n{documentText}",
    ],
  ]);

  const safeText = params.text.slice(0, 40_000);
  const extractionChain = prompt.pipe(llm);
  const output = await extractionChain.invoke({
    fileName: params.fileName ?? "unknown",
    documentText: safeText,
  });

  const extraction: ShipmentExtraction = {
    shipment_id: toNullableString(output.shipment_id),
    shipper: toNullableString(output.shipper),
    consignee: toNullableString(output.consignee),
    pickup_datetime: toNullableString(output.pickup_datetime),
    delivery_datetime: toNullableString(output.delivery_datetime),
    equipment_type: toNullableString(output.equipment_type),
    mode: toNullableString(output.mode),
    rate: toNullableNumber(output.rate),
    currency: toNullableString(output.currency),
    weight: toNullableNumber(output.weight),
    carrier_name: toNullableString(output.carrier_name),
  };

  const confidence = computeExtractionConfidence(extraction, output.self_assessed_confidence);

  return {
    extraction,
    confidence,
  };
}
