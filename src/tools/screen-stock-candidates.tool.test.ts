import assert from "node:assert/strict";
import test from "node:test";

import { extractStockCandidatesFromMxResult } from "./screen-stock-candidates.tool.js";
import type { MxSelectStockResult } from "../types/mx-select-stock.js";

test("extractStockCandidatesFromMxResult normalizes market suffixes and caps candidates", () => {
  const result: MxSelectStockResult = {
    status: 0,
    message: "ok",
    code: "100",
    msg: "OK",
    resultType: null,
    total: 2,
    totalRecordCount: 2,
    parserText: null,
    dataSource: "dataList",
    columns: [
      { title: "代码", key: "SECURITY_CODE", dateMsg: null, sortable: false, sortWay: null, redGreenAble: false, unit: null, dataType: "String" },
      { title: "名称", key: "SECURITY_SHORT_NAME", dateMsg: null, sortable: false, sortWay: null, redGreenAble: false, unit: null, dataType: "String" },
      { title: "市场代码简称", key: "MARKET_SHORT_NAME", dateMsg: null, sortable: false, sortWay: null, redGreenAble: false, unit: null, dataType: "String" },
      { title: "最新价(元)", key: "NEWEST_PRICE", dateMsg: "2026.04.24", sortable: false, sortWay: null, redGreenAble: false, unit: "元", dataType: "Double" },
      { title: "涨跌幅(%)", key: "CHG", dateMsg: "2026.04.24", sortable: false, sortWay: null, redGreenAble: false, unit: "%", dataType: "Double" },
      { title: "总市值(元)", key: "MARKET_VALUE", dateMsg: "2026.04.24", sortable: false, sortWay: null, redGreenAble: false, unit: "元", dataType: "Double" },
    ],
    dataList: [
      {
        SECURITY_CODE: "688808",
        SECURITY_SHORT_NAME: "N联讯",
        MARKET_SHORT_NAME: "SH",
        NEWEST_PRICE: "799.00",
        CHG: "875.82",
        MARKET_VALUE: "820.31亿",
      },
      {
        SECURITY_CODE: "920125",
        SECURITY_SHORT_NAME: "N鸿仕达",
        MARKET_SHORT_NAME: "BJ",
        NEWEST_PRICE: "50.02",
        CHG: "201.87",
        MARKET_VALUE: "28.09亿",
      },
    ],
    responseConditionList: [],
    totalCondition: null,
  };

  const candidates = extractStockCandidatesFromMxResult(result, 1);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.symbol, "688808.SH");
  assert.equal(candidates[0]?.name, "N联讯");
  assert.equal(candidates[0]?.mx.latestPrice, "799.00");
  assert.equal(candidates[0]?.mx.changePct, "875.82");
  assert.equal(candidates[0]?.mx.marketValue, "820.31亿");
});
