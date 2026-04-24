import { formatConfigEnvFallback } from "../config/env.js";
import type { MxSearchDocument, MxSearchSecurity } from "../types/mx-search.js";
import type { MxDataEntityTag, MxDataResult, MxDataTable } from "../types/mx-data.js";
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

  async queryData(toolQuery: string): Promise<MxDataResult> {
    const normalizedQuery = toolQuery.trim();
    if (!normalizedQuery) {
      throw new MxSearchServiceError("mx_data requires query");
    }

    const json = await this.postJson("query", { toolQuery: normalizedQuery }, "mx_data");
    const apiError = extractApiError(json);
    if (apiError) {
      throw new MxSearchServiceError(
        `mx_data 返回错误: ${apiError.code ?? "UNKNOWN"} ${apiError.message ?? ""}`.trim(),
      );
    }

    return normalizeMxDataResult(json);
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
    /\/(news-search|stock-screen|query|self-select\/get|self-select\/manage)$/i,
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

export function normalizeMxSelectStockResult(value: unknown): MxSelectStockResult {
  const root = asRecord(value);
  const data = asRecord(root.data);
  const nestedData = asRecord(data.data);
  const allResults = asRecord(nestedData.allResults);
  const result = asRecord(allResults.result);
  const businessCode = toNullableString(allResults.code) ?? toNullableString(nestedData.responseCode) ?? toNullableString(data.code);
  const rawTotalCondition = normalizeCondition(allResults.totalCondition);
  const flatTotalCondition = toNullableString(nestedData.totalCondition);

  const structuredColumns = normalizeColumns(result.columns);
  const structuredRows = normalizeDataList(result.dataList);
  const partialTable = structuredRows.length === 0
    ? parseMarkdownTable(toNullableString(nestedData.partialResults) ?? toNullableString(allResults.partialResults))
    : null;
  const fallbackColumns = partialTable
    ? partialTable.fieldnames.map((fieldname) => ({
        title: fieldname,
        key: fieldname,
        dateMsg: null,
        sortable: false,
        sortWay: null,
        redGreenAble: false,
        unit: null,
        dataType: "String",
      }))
    : [];
  const dataList = structuredRows.length > 0 ? structuredRows : (partialTable?.rows ?? []);
  const columns = structuredColumns.length > 0 ? structuredColumns : fallbackColumns;
  const dataSource = structuredRows.length > 0
    ? "dataList"
    : partialTable && partialTable.rows.length > 0
      ? "partialResults"
      : "none";

  return {
    status: toNullableNumber(root.status),
    message: toNullableString(root.message),
    code: businessCode,
    msg: toNullableString(data.message) ?? toNullableString(data.msg),
    resultType: toNullableNumber(result.resultType) ?? toNullableNumber(nestedData.resultType),
    total: toSafeNumber(result.total) || dataList.length,
    totalRecordCount: toSafeNumber(result.totalRecordCount) || dataList.length,
    parserText: toNullableString(nestedData.parserText),
    dataSource,
    columns,
    dataList,
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

export function normalizeMxDataResult(value: unknown): MxDataResult {
  const root = asRecord(value);
  const data = asRecord(root.data);
  const nestedData = asRecord(data.data);
  const searchResult = asRecord(nestedData.searchDataResultDTO ?? data.searchDataResultDTO);
  const dtoList = Array.isArray(searchResult.dataTableDTOList)
    ? searchResult.dataTableDTOList
    : Array.isArray(searchResult.rawDataTableDTOList)
      ? searchResult.rawDataTableDTOList
      : [];
  const tables: MxDataTable[] = [];
  const conditionParts: string[] = [];

  for (const [index, item] of dtoList.entries()) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const dto = item as Record<string, unknown>;
    const condition = toNullableString(dto.condition);
    const entityName = toNullableString(dto.entityName);
    if (condition) {
      conditionParts.push(`[${entityName ?? `表${index + 1}`}]\n${condition}`);
    }

    const table = normalizeMxDataTable(dto, index);
    if (table.rows.length === 0) {
      continue;
    }
    tables.push(table);
  }

  return {
    status: toNullableNumber(root.status),
    message: toNullableString(root.message),
    questionId: toNullableString(searchResult.questionId),
    entityTags: normalizeMxDataEntityTags(searchResult.entityTagDTOList ?? data.entityTagDTOList),
    conditionParts,
    tables,
    totalRows: tables.reduce((sum, table) => sum + table.rows.length, 0),
  };
}

function normalizeMxDataTable(dto: Record<string, unknown>, index: number): MxDataTable {
  const title =
    toNullableString(dto.title) ??
    toNullableString(dto.inputTitle) ??
    toNullableString(dto.entityName) ??
    `表${index + 1}`;
  const tableValue = dto.table ?? dto.rawTable;
  const { rows, fieldnames } = mxDataTableToRows(
    tableValue,
    dto.nameMap,
    dto.indicatorOrder,
    toNullableString(dto.entityName) ?? "指标",
    dto,
  );

  return {
    title,
    code: toNullableString(dto.code),
    entityName: toNullableString(dto.entityName),
    rows,
    fieldnames,
  };
}

function mxDataTableToRows(
  tableValue: unknown,
  nameMapValue: unknown,
  indicatorOrderValue: unknown,
  entityName: string,
  block: Record<string, unknown>,
): { rows: Array<Record<string, string>>; fieldnames: string[] } {
  if (Array.isArray(tableValue)) {
    return genericRowsToNamedRows(tableValue, nameMapValue);
  }
  if (typeof tableValue !== "object" || tableValue === null) {
    return { rows: [], fieldnames: [] };
  }

  const table = tableValue as Record<string, unknown>;
  const nameMap = normalizeStringMap(nameMapValue);
  const headers = Array.isArray(table.headName) ? table.headName : [];
  const order = orderedMxDataKeys(table, indicatorOrderValue);
  const codeMap = normalizeStringMap(
    block.returnCodeMap ?? block.returnCodeNameMap ?? block.codeMap,
  );

  if (headers.length > 0) {
    const dateColumn = nameMap.get("headNameSub") || nameMap.get("headName") || "date";
    const fieldnames = [
      dateColumn,
      ...order
        .map((key) => formatMxDataIndicatorLabel(key, nameMap, codeMap))
        .filter(Boolean),
    ];
    const rows = headers.map((header, rowIndex) => {
      const row: Record<string, string> = {
        [dateColumn]: flattenMxValue(header),
      };
      for (const key of order) {
        const label = formatMxDataIndicatorLabel(key, nameMap, codeMap);
        if (!label) {
          continue;
        }
        const values = table[key];
        const cell = Array.isArray(values) ? values[rowIndex] : rowIndex === 0 ? values : "";
        row[label] = flattenMxValue(cell);
      }
      return row;
    });
    return { rows, fieldnames };
  }

  const fieldnames = [entityName, "value"];
  const rows = order
    .map((key) => {
      const label = formatMxDataIndicatorLabel(key, nameMap, codeMap);
      if (!label) {
        return null;
      }
      return {
        [fieldnames[0]!]: label,
        [fieldnames[1]!]: flattenMxValue(table[key]),
      };
    })
    .filter((row): row is Record<string, string> => row != null);
  return { rows, fieldnames };
}

function genericRowsToNamedRows(
  value: unknown[],
  nameMapValue: unknown,
): { rows: Array<Record<string, string>>; fieldnames: string[] } {
  const records = value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  if (records.length === 0) {
    return { rows: [], fieldnames: [] };
  }

  const nameMap = normalizeStringMap(nameMapValue);
  const keys = Object.keys(records[0] ?? {});
  const fieldnames = keys.map((key) => nameMap.get(key) || key);
  const rows = records.map((record) => {
    const row: Record<string, string> = {};
    for (const key of keys) {
      row[nameMap.get(key) || key] = flattenMxValue(record[key]);
    }
    return row;
  });
  return { rows, fieldnames };
}

function orderedMxDataKeys(table: Record<string, unknown>, indicatorOrderValue: unknown): string[] {
  const dataKeys = Object.keys(table).filter((key) => key !== "headName");
  const ordered: string[] = [];
  const seen = new Set<string>();
  const indicatorOrder = Array.isArray(indicatorOrderValue) ? indicatorOrderValue.map((item) => String(item)) : [];

  for (const key of indicatorOrder) {
    if (dataKeys.includes(key) && !seen.has(key)) {
      ordered.push(key);
      seen.add(key);
    }
  }
  for (const key of dataKeys) {
    if (!seen.has(key)) {
      ordered.push(key);
      seen.add(key);
    }
  }
  return ordered;
}

function formatMxDataIndicatorLabel(
  key: string,
  nameMap: Map<string, string>,
  codeMap: Map<string, string>,
): string {
  const mapped = nameMap.get(key) ?? codeMap.get(key);
  if (mapped) {
    return mapped;
  }
  return /^\d+$/.test(key) ? "" : key;
}

function normalizeMxDataEntityTags(value: unknown): MxDataEntityTag[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      fullName: toNullableString(item.fullName),
      secuCode: toNullableString(item.secuCode),
      marketChar: toNullableString(item.marketChar),
      entityTypeName: toNullableString(item.entityTypeName),
      className: toNullableString(item.className),
    }));
}

function parseMarkdownTable(value: string | null | undefined): {
  rows: Array<Record<string, string>>;
  fieldnames: string[];
} | null {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const header = splitMarkdownCells(lines[0] ?? "");
  if (header.length === 0) {
    return null;
  }
  const dataStart = lines[1] && /^[\s|:-]+$/.test(lines[1]) ? 2 : 1;
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(dataStart)) {
    const cells = splitMarkdownCells(line);
    if (cells.length === 0) {
      continue;
    }
    const row: Record<string, string> = {};
    for (const [index, fieldname] of header.entries()) {
      row[fieldname] = cells[index] ?? "";
    }
    rows.push(row);
  }

  return rows.length > 0 ? { rows, fieldnames: header } : null;
}

function splitMarkdownCells(line: string): string[] {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell, index, cells) => {
      const isEdge = (index === 0 || index === cells.length - 1) && cell === "";
      return !isEdge;
    });
}

function normalizeStringMap(value: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const text = flattenMxValue(item);
      if (text) {
        map.set(String(index), text);
      }
    });
    return map;
  }
  if (typeof value !== "object" || value === null) {
    return map;
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const text = flattenMxValue(raw);
    if (text) {
      map.set(key, text);
    }
  }
  return map;
}

function flattenMxValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
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
