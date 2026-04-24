import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMxDataResult,
  normalizeMxSelectStockResult,
} from "./mx-search-service.js";

test("normalizeMxDataResult parses official searchDataResultDTO tables", () => {
  const result = normalizeMxDataResult({
    status: 0,
    message: "ok",
    data: {
      data: {
        searchDataResultDTO: {
          questionId: "question-1",
          entityTagDTOList: [
            {
              fullName: "东方财富",
              secuCode: "300059",
              marketChar: ".SZ",
              entityTypeName: "A股",
              className: "创业板股票",
            },
          ],
          dataTableDTOList: [
            {
              code: "300059.SZ",
              entityName: "东方财富 (300059.SZ)",
              title: "东方财富最新价",
              condition: "东方财富 最新价 涨跌幅",
              table: {
                headName: ["2026-04-24"],
                f2: [25.31],
                f3: [1.2],
              },
              nameMap: {
                headNameSub: "日期",
                f2: "最新价 (元)",
                f3: "涨跌幅 (%)",
              },
              indicatorOrder: ["f2", "f3"],
            },
          ],
        },
      },
    },
  });

  assert.equal(result.status, 0);
  assert.equal(result.message, "ok");
  assert.equal(result.questionId, "question-1");
  assert.equal(result.entityTags.length, 1);
  assert.equal(result.entityTags[0]?.fullName, "东方财富");
  assert.equal(result.tables.length, 1);
  assert.equal(result.totalRows, 1);
  assert.deepEqual(result.tables[0]?.fieldnames, ["日期", "最新价 (元)", "涨跌幅 (%)"]);
  assert.deepEqual(result.tables[0]?.rows[0], {
    日期: "2026-04-24",
    "最新价 (元)": "25.31",
    "涨跌幅 (%)": "1.2",
  });
});

test("normalizeMxSelectStockResult falls back to partialResults markdown table", () => {
  const result = normalizeMxSelectStockResult({
    status: 0,
    message: "ok",
    data: {
      data: {
        parserText: "今日涨幅大于2%的A股",
        partialResults: [
          "| 股票代码 | 股票简称 | 最新价 |",
          "| --- | --- | --- |",
          "| 300059 | 东方财富 | 25.31 |",
          "| 600519 | 贵州茅台 | 1580.00 |",
        ].join("\n"),
      },
    },
  });

  assert.equal(result.dataSource, "partialResults");
  assert.equal(result.total, 2);
  assert.equal(result.totalRecordCount, 2);
  assert.deepEqual(
    result.columns.map((column) => [column.title, column.key]),
    [
      ["股票代码", "股票代码"],
      ["股票简称", "股票简称"],
      ["最新价", "最新价"],
    ],
  );
  assert.deepEqual(result.dataList[0], {
    股票代码: "300059",
    股票简称: "东方财富",
    最新价: "25.31",
  });
});
