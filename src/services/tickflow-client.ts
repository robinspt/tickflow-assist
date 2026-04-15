import type {
  TickFlowBalanceSheetRecord,
  TickFlowCashFlowRecord,
  TickFlowFinancialMetricsRecord,
  TickFlowFinancialQueryOptions,
  TickFlowIncomeRecord,
  TickFlowInstrument,
  TickFlowQuote,
  TickFlowUniverseDetail,
  TickFlowUniverseSummary,
} from "../types/tickflow.js";

export class TickFlowClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TickFlowClientError";
  }
}

export class TickFlowClient {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  async fetchInstruments(symbols: string[]): Promise<TickFlowInstrument[]> {
    if (symbols.length === 0) {
      return [];
    }

    const url = new URL("/v1/instruments", this.baseUrl);
    url.searchParams.set("symbols", symbols.join(","));
    const response = await this.requestJson<{ data?: TickFlowInstrument[] }>(url.toString(), {
      method: "GET",
    });
    return response.data ?? [];
  }

  async fetchQuotes(symbols: string[]): Promise<TickFlowQuote[]> {
    if (symbols.length === 0) {
      return [];
    }

    const url = new URL("/v1/quotes", this.baseUrl);
    const response = await this.requestJson<{ data?: TickFlowQuote[] }>(url.toString(), {
      method: "POST",
      body: JSON.stringify({ symbols }),
    });
    return response.data ?? [];
  }

  async listUniverses(): Promise<TickFlowUniverseSummary[]> {
    const url = new URL("/v1/universes", this.baseUrl);
    const response = await this.requestJson<{ data?: TickFlowUniverseSummary[] }>(url.toString(), {
      method: "GET",
    });
    return response.data ?? [];
  }

  async fetchUniverse(id: string): Promise<TickFlowUniverseDetail | null> {
    const normalizedId = String(id ?? "").trim();
    if (!normalizedId) {
      return null;
    }

    const url = new URL(`/v1/universes/${encodeURIComponent(normalizedId)}`, this.baseUrl);
    const response = await this.requestJson<{ data?: TickFlowUniverseDetail | null }>(url.toString(), {
      method: "GET",
    });
    return response.data ?? null;
  }

  async fetchUniverseBatch(ids: string[]): Promise<Record<string, TickFlowUniverseDetail>> {
    const normalizedIds = ids
      .map((id) => String(id ?? "").trim())
      .filter(Boolean);
    if (normalizedIds.length === 0) {
      return {};
    }

    const url = new URL("/v1/universes/batch", this.baseUrl);
    const response = await this.requestJson<{ data?: Record<string, TickFlowUniverseDetail> }>(url.toString(), {
      method: "POST",
      body: JSON.stringify({ ids: normalizedIds }),
    });
    return response.data ?? {};
  }

  async fetchKlinesBatch<T = unknown>(
    symbols: string[],
    params: {
      period?: string;
      count?: number;
      adjust?: string;
      startTime?: number;
      endTime?: number;
    } = {},
  ): Promise<{ data?: Record<string, T> }> {
    if (symbols.length === 0) {
      return { data: {} };
    }

    const url = new URL("/v1/klines/batch", this.baseUrl);
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("period", params.period ?? "1d");
    url.searchParams.set("count", String(params.count ?? 90));
    url.searchParams.set("adjust", params.adjust ?? "forward");
    if (params.startTime != null) {
      url.searchParams.set("start_time", String(params.startTime));
    }
    if (params.endTime != null) {
      url.searchParams.set("end_time", String(params.endTime));
    }

    return this.requestJson<{ data?: Record<string, T> }>(url.toString(), {
      method: "GET",
    });
  }

  async fetchIntradayKlinesBatch<T = unknown>(
    symbols: string[],
    params: {
      period?: string;
      count?: number;
    } = {},
  ): Promise<{ data?: Record<string, T> }> {
    if (symbols.length === 0) {
      return { data: {} };
    }

    const url = new URL("/v1/klines/intraday/batch", this.baseUrl);
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("period", params.period ?? "1m");
    if (params.count != null) {
      url.searchParams.set("count", String(params.count));
    }

    return this.requestJson<{ data?: Record<string, T> }>(url.toString(), {
      method: "GET",
    });
  }

  async fetchBalanceSheet(
    symbols: string[],
    params: TickFlowFinancialQueryOptions = {},
  ): Promise<{ data?: Record<string, TickFlowBalanceSheetRecord[]> }> {
    return this.fetchFinancialRecords<TickFlowBalanceSheetRecord>(
      "/v1/financials/balance-sheet",
      symbols,
      params,
    );
  }

  async fetchCashFlow(
    symbols: string[],
    params: TickFlowFinancialQueryOptions = {},
  ): Promise<{ data?: Record<string, TickFlowCashFlowRecord[]> }> {
    return this.fetchFinancialRecords<TickFlowCashFlowRecord>(
      "/v1/financials/cash-flow",
      symbols,
      params,
    );
  }

  async fetchIncome(
    symbols: string[],
    params: TickFlowFinancialQueryOptions = {},
  ): Promise<{ data?: Record<string, TickFlowIncomeRecord[]> }> {
    return this.fetchFinancialRecords<TickFlowIncomeRecord>(
      "/v1/financials/income",
      symbols,
      params,
    );
  }

  async fetchFinancialMetrics(
    symbols: string[],
    params: TickFlowFinancialQueryOptions = {},
  ): Promise<{ data?: Record<string, TickFlowFinancialMetricsRecord[]> }> {
    return this.fetchFinancialRecords<TickFlowFinancialMetricsRecord>(
      "/v1/financials/metrics",
      symbols,
      params,
    );
  }

  private async fetchFinancialRecords<T>(
    endpoint: string,
    symbols: string[],
    params: TickFlowFinancialQueryOptions = {},
  ): Promise<{ data?: Record<string, T[]> }> {
    if (symbols.length === 0) {
      return { data: {} };
    }

    const url = new URL(endpoint, this.baseUrl);
    url.searchParams.set("symbols", symbols.join(","));
    if (params.start_date) {
      url.searchParams.set("start_date", params.start_date);
    }
    if (params.end_date) {
      url.searchParams.set("end_date", params.end_date);
    }
    if (params.latest != null) {
      url.searchParams.set("latest", String(params.latest));
    }

    return this.requestJson<{ data?: Record<string, T[]> }>(url.toString(), {
      method: "GET",
    });
  }

  private async requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    headers.set("x-api-key", this.apiKey);
    headers.set("Content-Type", "application/json");

    const first = await fetch(url, { ...init, headers });
    if (first.status === 429) {
      const retryAfter = Number(first.headers.get("Retry-After") ?? "5");
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      const retry = await fetch(url, { ...init, headers });
      return this.handleResponse<T>(retry, url);
    }
    return this.handleResponse<T>(first, url);
  }

  private async handleResponse<T>(response: Response, url: string): Promise<T> {
    if (!response.ok) {
      const text = await response.text();
      throw new TickFlowClientError(
        `TickFlow request failed: ${response.status} ${response.statusText} (${url}) ${text}`.trim(),
      );
    }

    return (await response.json()) as T;
  }
}
