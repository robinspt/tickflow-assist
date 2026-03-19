export interface MxSearchSecurity {
  secuCode?: string | null;
  secuName?: string | null;
  secuType?: string | null;
  [key: string]: unknown;
}

export interface MxSearchDocument {
  title: string;
  trunk: string;
  secuList: MxSearchSecurity[];
  source: string | null;
  publishedAt: string | null;
  raw: Record<string, unknown>;
}
