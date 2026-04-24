import assert from "node:assert/strict";
import test from "node:test";

import type { MxSelfSelectResult, MxSelfSelectStock } from "../types/mx-self-select.js";
import type { WatchlistItem } from "../types/domain.js";
import {
  pushEastmoneyWatchlistTool,
  syncEastmoneyWatchlistTool,
} from "./eastmoney-watchlist.tool.js";

const localWatchlistItem: WatchlistItem = {
  symbol: "002261.SZ",
  name: "拓维信息",
  costPrice: 34.15,
  addedAt: "2026-04-01 09:30:00",
  sector: null,
  themes: [],
  themeQuery: null,
  themeUpdatedAt: null,
};

test("sync_eastmoney_watchlist imports missing Eastmoney symbols without profile enrichment by default", async () => {
  const addedSymbols: Array<{ symbol: string; enrichProfile: unknown; name: unknown }> = [];
  const tool = syncEastmoneyWatchlistTool(
    {
      async getSelfSelectWatchlist() {
        return makeSelfSelectResult([
          makeSelfSelectStock("002261.SZ", "拓维信息"),
          makeSelfSelectStock("300059.SZ", "东方财富"),
        ]);
      },
    } as never,
    {
      async list() {
        return [localWatchlistItem];
      },
      async add(symbol: string, _costPrice: number | null, options?: { enrichProfile?: boolean }) {
        addedSymbols.push({
          symbol,
          enrichProfile: options?.enrichProfile,
          name: (options as { name?: string } | undefined)?.name,
        });
        return {
          item: {
            ...localWatchlistItem,
            symbol,
            name: "东方财富",
          },
          profileError: null,
        };
      },
    } as never,
  );

  const result = await tool.run({});

  assert.deepEqual(addedSymbols, [{ symbol: "300059.SZ", enrichProfile: false, name: "东方财富" }]);
  assert.match(result, /东方财富自选: 2 只/);
  assert.match(result, /本地已有: 1 只/);
  assert.match(result, /本次新增: 1 只/);
});

test("push_eastmoney_watchlist adds selected local symbols to Eastmoney", async () => {
  const queries: string[] = [];
  const tool = pushEastmoneyWatchlistTool(
    {
      async manageSelfSelect(query: string) {
        queries.push(query);
        return {
          status: 0,
          code: null,
          message: "操作成功",
          query,
          raw: {},
        };
      },
    } as never,
    {
      async list() {
        return [
          localWatchlistItem,
          {
            ...localWatchlistItem,
            symbol: "300059.SZ",
            name: "东方财富",
          },
        ];
      },
    } as never,
  );

  const result = await tool.run({ rawInput: { symbol: "300059" } });

  assert.deepEqual(queries, ["把300059 东方财富添加到我的自选股列表"]);
  assert.match(result, /成功: 1 只 \| 失败: 0 只/);
  assert.match(result, /妙想自选接口调用: 1 次/);
});

function makeSelfSelectResult(stocks: MxSelfSelectStock[]): MxSelfSelectResult {
  return {
    status: 0,
    code: null,
    message: "ok",
    columns: [],
    stocks,
    raw: {},
  };
}

function makeSelfSelectStock(symbol: string, name: string): MxSelfSelectStock {
  return {
    symbol,
    rawSymbol: symbol,
    name,
    latestPrice: null,
    changePercent: null,
    changeAmount: null,
    turnoverRate: null,
    volumeRatio: null,
    raw: {},
  };
}
