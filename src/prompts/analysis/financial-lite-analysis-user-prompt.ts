import type { FinancialLiteSnapshot } from "../../services/financial-lite-service.js";

export const FINANCIAL_LITE_ANALYSIS_SYSTEM_PROMPT = `
你是一位专业的A股基本面分析师。当前是 financial-lite 模式，只能基于少量核心财务指标做粗粒度判断，不能把它当成完整财报分析。

输出要求：
1. 先给出一段 80-120 字中文核心结论，不要在正文中混入 JSON。
2. 核心结论后按以下小节分段展开，每节 1-3 句：
- 盈利能力与成长性
- 杠杆与偿债压力
- 现金流信号或覆盖不足说明
3. 如果指标覆盖不足，必须明确指出“当前为 lite 指标拖底模式，结论置信度有限”，并说明缺了哪些关键维度。
4. 分段内容只允许基于已提供指标推断，不要把缺失指标直接当成负面事实。
5. 最后输出 \`\`\`json 代码块，结构如下：
{
  "score": 5,
  "bias": "neutral",
  "strengths": ["..."],
  "risks": ["..."],
  "watch_items": ["..."]
}

规则：
- score 为 1-10 的整数。
- bias 只能是 positive / neutral / negative。
- strengths / risks / watch_items 各输出 1-3 条。
- 不要臆造不存在的财报字段，不要把缺失指标当成负面事实。
- 不要引用市场价格与K线信息。
`;

export function buildFinancialLiteAnalysisUserPrompt(params: {
  symbol: string;
  companyName: string;
  snapshot: FinancialLiteSnapshot;
}): string {
  return [
    `请基于 lite 基本面指标分析 ${params.companyName}（${params.symbol}）。`,
    `数据来源: mx_select_stock`,
    `检索问句: ${params.snapshot.query}`,
    `指标日期: ${params.snapshot.asOf ?? "-"}`,
    `解析说明: ${params.snapshot.parserText ?? "-"}`,
    "",
    "## 可用核心指标",
    ...renderMetrics(params.snapshot.metrics),
    "",
    "请基于这些指标评估盈利能力、成长性、杠杆压力与现金质量；若缺少关键指标，请在正文中明确说明覆盖有限。",
  ].join("\n");
}

function renderMetrics(metrics: FinancialLiteSnapshot["metrics"]): string[] {
  if (metrics.length === 0) {
    return ["- 暂无可用指标"];
  }

  return metrics.map((metric) => {
    const suffix = [metric.unit, metric.asOf].filter(Boolean).join(" | ");
    return `- ${metric.label}=${formatValue(metric.value)}${suffix ? ` (${suffix})` : ""}`;
  });
}

function formatValue(value: number | string | null): string {
  if (value == null) {
    return "-";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(4) : "-";
  }
  return value;
}
