import { formatConfigEnvFallback } from "../config/env.js";
import type { MxSearchDocument, MxSearchSecurity } from "../types/mx-search.js";
import type {
  MxSelfSelectColumn,
  MxSelfSelectManageResult,
  MxSelfSelectResult,
  MxSelfSelectStock,
} from "../types/mx-self-select.js";
import type {
  MxSelectStockColumn,
  MxSelectStockCondition,
  MxSelectStockResult,
} from "../types/mx-select-stock.js";
import { normalizeSymbol } from "../utils/symbol.js";

interface MxSearchResponseError {
  code?: string;
  message?: string;
}

export class MxSearchServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MxSearchServiceError";
  }
}

export class MxApiService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly apiKey: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiBaseUrl.trim() && this.apiKey.trim());
  }

  getConfigurationError(featureName = "mx_search"): string | null {
    if (!this.apiBaseUrl.trim()) {
      return `${featureName} 未配置接口地址，请设置 mxSearchApiUrl 或环境变量 ${formatConfigEnvFallback("mxSearchApiUrl")}`;
    }
    if (!this.apiKey.trim()) {
      return `${featureName} 未配置 API Key，请设置插件配置 mxSearchApiKey 或环境变量 ${formatConfigEnvFallback("mxSearchApiKey")}`;
    }
    return null;
  }

  async search(query: string): Promise<MxSearchDocument[]> {
    const json = await this.postJson("news-search", { query }, "mx_search");
    const apiError = extractApiError(json);
    if (apiError) {
      throw new MxSearchServiceError(
        `mx_search 返回错误: ${apiError.code ?? "UNKNOWN"} ${apiError.message ?? ""}`.trim(),
      );
    }

    return normalizeMxSearchDocuments(json);
  }

  async selectStocks(input: {
    keyword: string;
    pageNo?: number;
    pageSize?: number;
  }): Promise<MxSelectStockResult> {
    const json = await this.postJson(
      "stock-screen",
      {
        keyword: input.keyword,
        pageNo: input.pageNo ?? 1,
        pageSize: input.pageSize ?? 20,
      },
      "mx_select_stock",
    );

    return normalizeMxSelectStockResult(json);
  }

  async getSelfSelectWatchlist(): Promise<MxSelfSelectResult> {
    const json = await this.postJson("self-select/get", {}, "mx_zixuan");
    const apiError = extractApiError(json);
    if (apiError) {
      throw new MxSearchServiceError(
        `mx_zixuan 返回错误: ${apiError.code ?? "UNKNOWN"} ${apiError.message ?? ""}`.trim(),
      );
    }

    return normalizeMxSelfSelectResult(json);
  }

  async manageSelfSelect(query: string): Promise<MxSelfSelectManageResult> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new MxSearchServiceError("mx_zixuan requires query");
    }

    const json = await this.postJson("self-select/manage", { query: normalizedQuery }, "mx_zixuan");
    const apiError = extractApiError(json);
    if (apiError) {
      throw new MxSearchServiceError(
        `mx_zixuan 返回错误: ${apiError.code ?? "UNKNOWN"} ${apiError.message ?? ""}`.trim(),
      );
    }

    return normalizeMxSelfSelectManageResult(json, normalizedQuery);
  }

  private async postJson(endpoint: string, body: Record<string, unknown>, toolName: string): Promise<unknown> {
    const configError = this.getConfigurationError(toolName);
    if (configError) {
      throw new MxSearchServiceError(configError);
    }

    const response = await fetch(buildMxEndpointUrl(this.apiBaseUrl, endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new MxSearchServiceError(
        `${toolName} 请求失败: ${response.status} ${response.statusText} ${text}`.trim(),
      );
    }

    return response.json();
  }
}

export class MxSearchService extends MxApiService {}

function buildMxEndpointUrl(baseUrl: string, endpoint: string): string {
  const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedEndpoint = endpoint.replace(/^\/+/, "");
  const normalizedBase = trimmedBase.replace(
    /\/(news-search|stock-screen|self-select\/get|self-select\/manage)$/i,
    "",
  );

  if (trimmedBase.endsWith(`/${normalizedEndpoint}`)) {
    return trimmedBase;
  }

  return `${normalizedBase}/${normalizedEndpoint}`;
}

function extractApiError(value: unknown): MxSearchResponseError | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : undefined;
  const message = typeof record.message === "string" ? record.message : undefined;
  const numericStatus = toNullableNumber(record.status);
  const numericCode = toNullableNumber(record.code);

  if ((numericStatus != null && numericStatus === 0) || (numericCode != null && numericCode === 0)) {
    return null;
  }
  if (message && ["ok", "success", "成功"].includes(message.trim().toLowerCase())) {
    return null;
  }
  if (!code && !message) {
    return null;
  }
  if ("title" in record || "trunk" in record || Array.isArray(record.list) || Array.isArray(record.data)) {
    return null;
  }
  return { code, message };
}

export function normalizeMxSearchDocuments(value: unknown): MxSearchDocument[] {
  const root = asRecord(value);
  const nestedData = asRecord(asRecord(root.data).data);
  const llmSearchResponse = asRecord(nestedData.llmSearchResponse);
  const sourceValue = Array.isArray(llmSearchResponse.data) ? llmSearchResponse.data : value;
  const candidates = collectCandidateItems(sourceValue);
  const documents: MxSearchDocument[] = [];
  const seen = new Set<string>();

  for (const item of candidates) {
    const normalized = normalizeDocument(item);
    if (!normalized) {
      continue;
    }

    const fingerprint = `${normalized.title}\n${normalized.trunk}`;
    if (seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    documents.push(normalized);
  }

  return documents;
}

function collectCandidateItems(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCandidateItems(item, depth + 1));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (looksLikeDocument(record)) {
    return [record];
  }

  const candidates: Record<string, unknown>[] = [];
  for (const key of ["data", "list", "result", "results", "items", "records"]) {
    if (key in record) {
      candidates.push(...collectCandidateItems(record[key], depth + 1));
    }
  }

  if (candidates.length > 0) {
    return candidates;
  }

  return Object.values(record).flatMap((item) => collectCandidateItems(item, depth + 1));
}

function looksLikeDocument(value: Record<string, unknown>): boolean {
  return (
    typeof value.title === "string"
    || typeof value.name === "string"
    || typeof value.headline === "string"
    || typeof value.trunk === "string"
    || typeof value.content === "string"
    || typeof value.summary === "string"
    || typeof value.abstract === "string"
    || typeof value.text === "string"
    || Array.isArray(value.secuList)
  );
}

function normalizeDocument(value: Record<string, unknown>): MxSearchDocument | null {
  const title = pickFirstString(value, ["title", "name", "headline"]);
  const trunk = pickFirstString(value, ["trunk", "content", "summary", "abstract", "text"]);
  if (!title && !trunk) {
    return null;
  }

  return {
    title: title || "未命名资讯",
    trunk: trunk || "",
    secuList: normalizeSecurities(value.secuList),
    source: pickFirstString(value, ["source", "media", "sourceName", "mediaName"]) ?? null,
    publishedAt: pickFirstString(value, ["publishTime", "publishedAt", "showTime", "date", "ctime"]) ?? null,
    raw: value,
  };
}

function normalizeSecurities(value: unknown): MxSearchSecurity[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      ...item,
      secuCode: toNullableString(item.secuCode),
      secuName: toNullableString(item.secuName),
      secuType: toNullableString(item.secuType),
    }));
}

function pickFirstString(
  value: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text || null;
}

function normalizeMxSelectStockResult(value: unknown): MxSelectStockResult {
  const root = asRecord(value);
  const data = asRecord(root.data);
  const nestedData = asRecord(data.data);
  const allResults = asRecord(nestedData.allResults);
  const result = asRecord(allResults.result);
  const businessCode = toNullableString(allResults.code) ?? toNullableString(nestedData.responseCode) ?? toNullableString(data.code);
  const rawTotalCondition = normalizeCondition(allResults.totalCondition);
  const flatTotalCondition = toNullableString(nestedData.totalCondition);

  return {
    status: toNullableNumber(root.status),
    message: toNullableString(root.message),
    code: businessCode,
    msg: toNullableString(data.message) ?? toNullableString(data.msg),
    resultType: toNullableNumber(result.resultType) ?? toNullableNumber(nestedData.resultType),
    total: toSafeNumber(result.total),
    totalRecordCount: toSafeNumber(result.totalRecordCount),
    parserText: toNullableString(nestedData.parserText),
    columns: normalizeColumns(result.columns),
    dataList: normalizeDataList(result.dataList),
    responseConditionList: normalizeConditions(allResults.responseConditionList ?? nestedData.responseConditionList),
    totalCondition:
      rawTotalCondition ??
      (flatTotalCondition
        ? {
            describe: flatTotalCondition,
            stockCount: toNullableNumber(nestedData.securityCount),
          }
        : null),
  };
}

function normalizeMxSelfSelectResult(value: unknown): MxSelfSelectResult {
  const root = asRecord(value);
  const data = asRecord(root.data);
  const nestedData = asRecord(data.data);
  const allResults = asRecord(data.allResults ?? nestedData.allResults);
  const result = asRecord(allResults.result ?? data.result ?? nestedData.result);
  const rows = normalizeDataList(result.dataList ?? allResults.dataList ?? data.dataList ?? nestedData.dataList);

  return {
    status: toNullableNumber(root.status),
    code: toNullableString(root.code) ?? toNullableString(allResults.code) ?? toNullableString(nestedData.responseCode),
    message: toNullableString(root.message) ?? toNullableString(data.message) ?? toNullableString(data.msg),
    columns: normalizeSelfSelectColumns(result.columns ?? allResults.columns ?? data.columns ?? nestedData.columns),
    stocks: rows
      .map((row) => normalizeSelfSelectStock(row))
      .filter((item): item is MxSelfSelectStock => item != null),
    raw: value,
  };
}

function normalizeMxSelfSelectManageResult(value: unknown, query: string): MxSelfSelectManageResult {
  const root = asRecord(value);
  const data = asRecord(root.data);
  const nestedData = asRecord(data.data);
  const allResults = asRecord(data.allResults ?? nestedData.allResults);

  return {
    status: toNullableNumber(root.status),
    code: toNullableString(root.code) ?? toNullableString(allResults.code) ?? toNullableString(nestedData.responseCode),
    message:
      toNullableString(root.message) ??
      toNullableString(data.message) ??
      toNullableString(data.msg) ??
      toNullableString(allResults.message) ??
      "已完成",
    query,
    raw: value,
  };
}

function normalizeSelfSelectColumns(value: unknown): MxSelfSelectColumn[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      title: String(item.title ?? item.name ?? item.key ?? ""),
      key: String(item.key ?? ""),
    }))
    .filter((item) => item.key);
}

function normalizeSelfSelectStock(value: Record<string, unknown>): MxSelfSelectStock | null {
  const rawSymbol = pickFirstString(value, [
    "SECURITY_CODE",
    "SECUCODE",
    "SECURITYCODE",
    "secuCode",
    "symbol",
    "code",
  ]) ?? null;
  const symbol = normalizeSelfSelectSymbol(rawSymbol);
  if (!symbol) {
    return null;
  }

  return {
    symbol,
    rawSymbol,
    name:
      pickFirstString(value, [
        "SECURITY_SHORT_NAME",
        "SECURITY_NAME_ABBR",
        "SECURITY_NAME",
        "secuName",
        "name",
      ]) ?? symbol,
    latestPrice: pickFirstCell(value, ["NEWEST_PRICE", "LATEST_PRICE", "price"]),
    changePercent: pickFirstCell(value, ["CHG", "CHANGE_PERCENT", "pctChg"]),
    changeAmount: pickFirstCell(value, ["PCHG", "CHANGE", "change"]),
    turnoverRate: pickFirstCell(value, ["010000_TURNOVER_RATE", "TURNOVER_RATE", "turnoverRate"]),
    volumeRatio: pickFirstCell(value, ["010000_LIANGBI", "VOLUME_RATIO", "volumeRatio"]),
    raw: value,
  };
}

function normalizeSelfSelectSymbol(value: string | null): string | null {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) {
    return null;
  }
  const direct = text.match(/^\d{6}\.(SH|SZ|BJ)$/);
  if (direct) {
    return text;
  }
  const digits = text.match(/\d{6}/)?.[0];
  return digits ? normalizeSymbol(digits) : null;
}

function pickFirstCell(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (candidate != null && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return null;
}

function normalizeColumns(value: unknown): MxSelectStockColumn[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      title: String(item.title ?? item.key ?? ""),
      key: String(item.key ?? ""),
      dateMsg: toNullableString(item.dateMsg),
      sortable: Boolean(item.sortable),
      sortWay: toNullableString(item.sortWay),
      redGreenAble: Boolean(item.redGreenAble),
      unit: toNullableString(item.unit),
      dataType: toNullableString(item.dataType),
    }))
    .filter((item) => item.key);
}

function normalizeDataList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
}

function normalizeConditions(value: unknown): MxSelectStockCondition[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeCondition(item))
    .filter((item): item is MxSelectStockCondition => item != null);
}

function normalizeCondition(value: unknown): MxSelectStockCondition | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const describe = toNullableString(record.describe);
  if (!describe) {
    return null;
  }
  return {
    describe,
    stockCount: toNullableNumber(record.stockCount),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toSafeNumber(value: unknown): number {
  return toNullableNumber(value) ?? 0;
}
