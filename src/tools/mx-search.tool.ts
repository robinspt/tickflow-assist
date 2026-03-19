import { MxApiService } from "../services/mx-search-service.js";

interface MxSearchInput {
  query: string;
  limit: number;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

function parseInput(rawInput: unknown): MxSearchInput {
  if (typeof rawInput === "string" && rawInput.trim()) {
    return {
      query: rawInput.trim(),
      limit: DEFAULT_LIMIT,
    };
  }

  if (typeof rawInput === "object" && rawInput !== null) {
    const obj = rawInput as Record<string, unknown>;
    const query = String(obj.query ?? obj.keyword ?? obj.q ?? "").trim();
    const limit = obj.limit == null ? DEFAULT_LIMIT : Number(obj.limit);
    if (!query) {
      throw new Error("mx_search requires query");
    }
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error("mx_search limit must be > 0");
    }
    return {
      query,
      limit: Math.min(Math.trunc(limit), MAX_LIMIT),
    };
  }

  throw new Error("invalid mx_search input");
}

export function mxSearchTool(mxSearchService: MxApiService) {
  return {
    name: "mx_search",
    description: "Search timely market information such as news, announcements, reports, policy, and event interpretation.",
    async run({ rawInput }: { rawInput?: unknown }): Promise<string> {
      const input = parseInput(rawInput);
      const documents = await mxSearchService.search(input.query);
      const selected = documents.slice(0, input.limit);

      if (selected.length === 0) {
        return [
          `🔎 妙想搜索: ${input.query}`,
          "结果数: 0",
          "⚠️ 未检索到匹配资讯",
        ].join("\n");
      }

      const lines = [
        `🔎 妙想搜索: ${input.query}`,
        `结果数: ${documents.length}`,
        `展示: ${selected.length}`,
        "",
      ];

      selected.forEach((item, index) => {
        lines.push(`${index + 1}. ${item.title}`);
        if (item.publishedAt) {
          lines.push(`时间: ${item.publishedAt}`);
        }
        if (item.source) {
          lines.push(`来源: ${item.source}`);
        }
        if (item.secuList.length > 0) {
          lines.push(`关联标的: ${formatSecurities(item.secuList)}`);
        }
        lines.push("正文:");
        lines.push(item.trunk || "无正文");
        if (index < selected.length - 1) {
          lines.push("");
        }
      });

      return lines.join("\n");
    },
  };
}

function formatSecurities(securities: Array<{ secuCode?: string | null; secuName?: string | null; secuType?: string | null }>): string {
  return securities
    .map((item) => {
      const main = [item.secuName, item.secuCode].filter(Boolean).join(" ");
      return item.secuType ? `${main} (${item.secuType})` : main;
    })
    .filter(Boolean)
    .join("；");
}
