export interface Jin10FlashItem {
  content: string;
  time: string;
  url: string;
  raw: Record<string, unknown>;
}

export interface Jin10FlashPage {
  hasMore: boolean;
  items: Jin10FlashItem[];
  nextCursor: string | null;
}

export interface Jin10FlashRecord {
  flash_key: string;
  published_at: string;
  published_ts: number;
  content: string;
  url: string;
  ingested_at: string;
  raw: Record<string, unknown>;
}

export interface Jin10FlashDeliveryEntry {
  flash_key: string;
  published_at: string;
  symbols: string[];
  headline: string;
  reason: string;
  importance: "high" | "medium" | "low";
  message: string;
  delivered_at: string;
}
