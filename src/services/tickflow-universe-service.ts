import { formatChinaDateTime } from "../utils/china-time.js";
import type { TickFlowUniverseDetail, TickFlowUniverseSummary } from "../types/tickflow.js";
import { TickFlowClient } from "./tickflow-client.js";
import {
  UniverseMembershipRepository,
  type UniverseMembershipEntry,
} from "../storage/repositories/universe-membership-repo.js";
import {
  UniverseRepository,
  type StoredUniverseSummary,
} from "../storage/repositories/universe-repo.js";

const UNIVERSE_BATCH_SIZE = 50;
const UNIVERSE_CACHE_REFRESH_MS = 24 * 60 * 60 * 1000;
const SHENWAN_UNIVERSE_PATTERN = /^CN_Equity_(SW[123])_(\d{6})$/;

export interface TickFlowIndustryProfile {
  sectorPath: string | null;
  sw1Name: string | null;
  sw2Name: string | null;
  sw3Name: string | null;
  sw1UniverseId: string | null;
  sw2UniverseId: string | null;
  sw3UniverseId: string | null;
  industryCode: string | null;
}

interface CachedUniverseCatalog {
  summariesById: Map<string, StoredUniverseSummary>;
  membershipUniverseIdsBySymbol: Map<string, string[]>;
  symbolsByUniverseId: Map<string, string[]>;
  syncedAtTs: number;
}

export class TickFlowUniverseService {
  private catalog: CachedUniverseCatalog | null = null;

  constructor(
    private readonly client: TickFlowClient,
    private readonly universeRepository: UniverseRepository,
    private readonly membershipRepository: UniverseMembershipRepository,
  ) {}

  async resolveIndustryProfile(symbol: string): Promise<TickFlowIndustryProfile | null> {
    const catalog = await this.ensureCatalog();
    const universeIds = catalog.membershipUniverseIdsBySymbol.get(symbol) ?? [];
    if (universeIds.length === 0) {
      return null;
    }

    const summaries = universeIds
      .map((id) => catalog.summariesById.get(id))
      .filter((item): item is StoredUniverseSummary => item != null)
      .map((summary) => ({
        summary,
        shenwan: parseShenwanUniverse(summary),
      }))
      .filter((item): item is { summary: StoredUniverseSummary; shenwan: ParsedShenwanUniverse } => item.shenwan != null);

    if (summaries.length === 0) {
      return null;
    }

    const sw1 = summaries.find((item) => item.shenwan.level === "SW1") ?? null;
    const sw2 = summaries.find((item) => item.shenwan.level === "SW2") ?? null;
    const sw3 = summaries.find((item) => item.shenwan.level === "SW3") ?? null;

    const names = [sw1?.shenwan.label, sw2?.shenwan.label, sw3?.shenwan.label]
      .filter((value): value is string => Boolean(value));

    return {
      sectorPath: names.length > 0 ? names.join("-") : null,
      sw1Name: sw1?.shenwan.label ?? null,
      sw2Name: sw2?.shenwan.label ?? null,
      sw3Name: sw3?.shenwan.label ?? null,
      sw1UniverseId: sw1?.summary.id ?? null,
      sw2UniverseId: sw2?.summary.id ?? null,
      sw3UniverseId: sw3?.summary.id ?? null,
      industryCode: sw3?.shenwan.code ?? sw2?.shenwan.code ?? sw1?.shenwan.code ?? null,
    };
  }

  async listUniverseSymbols(universeId: string): Promise<string[]> {
    const catalog = await this.ensureCatalog();
    return [...(catalog.symbolsByUniverseId.get(universeId) ?? [])];
  }

  private async ensureCatalog(force = false): Promise<CachedUniverseCatalog> {
    if (!force && this.catalog && Date.now() - this.catalog.syncedAtTs < UNIVERSE_CACHE_REFRESH_MS) {
      return this.catalog;
    }

    const localCatalog = await this.loadCatalogFromRepositories();
    if (!force && localCatalog && Date.now() - localCatalog.syncedAtTs < UNIVERSE_CACHE_REFRESH_MS) {
      this.catalog = localCatalog;
      return localCatalog;
    }

    try {
      const syncedCatalog = await this.syncCatalogFromTickFlow();
      this.catalog = syncedCatalog;
      return syncedCatalog;
    } catch (error) {
      if (localCatalog) {
        console.warn(`[tickflow-universe] remote sync failed, falling back to local cache: ${toErrorMessage(error)}`);
        this.catalog = localCatalog;
        return localCatalog;
      }
      throw error;
    }
  }

  private async loadCatalogFromRepositories(): Promise<CachedUniverseCatalog | null> {
    const [summaries, memberships] = await Promise.all([
      this.universeRepository.list(),
      this.membershipRepository.list(),
    ]);

    if (summaries.length === 0 || memberships.length === 0) {
      return null;
    }

    return buildCachedCatalog(summaries, memberships);
  }

  private async syncCatalogFromTickFlow(): Promise<CachedUniverseCatalog> {
    const summaries = await this.client.listUniverses();
    if (summaries.length === 0) {
      throw new Error("TickFlow universe list is empty");
    }

    const details = await this.fetchUniverseDetails(summaries);
    const syncedAt = formatChinaDateTime();
    const universeRows = summaries.map((summary) => details[summary.id] ?? summary);
    const memberships = universeRows.flatMap((item) => toUniverseMembershipEntries(item));
    if (memberships.length === 0) {
      throw new Error("TickFlow universe detail sync returned no membership rows");
    }

    await Promise.all([
      this.universeRepository.replaceAll(universeRows, syncedAt),
      this.membershipRepository.replaceAll(memberships),
    ]);

    const cached = buildCachedCatalog(
      universeRows.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description ?? null,
        region: item.region,
        category: item.category,
        symbolCount: Math.max(0, Math.trunc(Number(item.symbol_count ?? 0))),
        syncedAt,
      })),
      memberships,
    );
    this.catalog = cached;
    return cached;
  }

  private async fetchUniverseDetails(
    summaries: TickFlowUniverseSummary[],
  ): Promise<Record<string, TickFlowUniverseDetail>> {
    const details: Record<string, TickFlowUniverseDetail> = {};
    const ids = summaries.map((summary) => summary.id);

    for (let index = 0; index < ids.length; index += UNIVERSE_BATCH_SIZE) {
      const chunk = ids.slice(index, index + UNIVERSE_BATCH_SIZE);
      const result = await this.client.fetchUniverseBatch(chunk);
      for (const [id, detail] of Object.entries(result)) {
        details[id] = detail;
      }

      const missingIds = chunk.filter((id) => details[id] == null);
      for (const missingId of missingIds) {
        const detail = await this.client.fetchUniverse(missingId);
        if (detail) {
          details[missingId] = detail;
        }
      }
    }

    return details;
  }
}

interface ParsedShenwanUniverse {
  level: "SW1" | "SW2" | "SW3";
  code: string;
  label: string;
}

function buildCachedCatalog(
  summaries: StoredUniverseSummary[],
  memberships: UniverseMembershipEntry[],
): CachedUniverseCatalog {
  const summariesById = new Map(summaries.map((item) => [item.id, item]));
  const membershipUniverseIdsBySymbol = new Map<string, string[]>();
  const symbolsByUniverseId = new Map<string, string[]>();

  for (const membership of memberships) {
    pushUnique(membershipUniverseIdsBySymbol, membership.symbol, membership.universeId);
    pushUnique(symbolsByUniverseId, membership.universeId, membership.symbol);
  }

  const syncedAtTs = summaries.reduce((latest, item) => {
    const timestamp = Date.parse(toIsoLikeTimestamp(item.syncedAt));
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);

  return {
    summariesById,
    membershipUniverseIdsBySymbol,
    symbolsByUniverseId,
    syncedAtTs,
  };
}

function parseShenwanUniverse(summary: StoredUniverseSummary): ParsedShenwanUniverse | null {
  const match = summary.id.match(SHENWAN_UNIVERSE_PATTERN);
  if (!match) {
    return null;
  }

  const [, level = "", code = ""] = match;
  const label = extractUniverseLabel(summary.name, summary.description);
  if (!label) {
    return null;
  }

  return {
    level: level as ParsedShenwanUniverse["level"],
    code,
    label,
  };
}

function extractUniverseLabel(name: string, description: string | null): string | null {
  const descriptionLabel = String(description ?? "")
    .replace(/^申万[123]级行业[:：]\s*/, "")
    .trim();
  if (descriptionLabel) {
    return descriptionLabel;
  }

  const nameLabel = String(name ?? "")
    .replace(/^SW[123]/, "")
    .trim();
  return nameLabel || null;
}

function toUniverseMembershipEntries(item: TickFlowUniverseSummary | TickFlowUniverseDetail): UniverseMembershipEntry[] {
  if (!("symbols" in item) || !Array.isArray(item.symbols)) {
    return [];
  }

  return item.symbols
    .map((symbol) => String(symbol ?? "").trim())
    .filter(Boolean)
    .map((symbol) => ({
      universeId: item.id,
      symbol,
    }));
}

function pushUnique(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) {
    if (!existing.includes(value)) {
      existing.push(value);
    }
    return;
  }
  map.set(key, [value]);
}

function toIsoLikeTimestamp(value: string): string {
  const text = value.trim();
  if (!text) {
    return text;
  }
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}+08:00`
    : text;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
