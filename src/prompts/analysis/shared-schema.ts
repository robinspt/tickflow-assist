export const KEY_LEVELS_JSON_SCHEMA_INNER = [
  '"current_price": number,',
  '"stop_loss": number | null,',
  '"breakthrough": number | null,',
  '"support": number | null,',
  '"cost_level": number | null,',
  '"resistance": number | null,',
  '"take_profit": number | null,',
  '"gap": number | null,',
  '"target": number | null,',
  '"round_number": number | null,',
  '"score": integer',
].join("\n");

export const KEY_LEVELS_JSON_SCHEMA = [
  "{",
  indentPromptBlock(KEY_LEVELS_JSON_SCHEMA_INNER, 2),
  "}",
].join("\n");

export const KEY_LEVELS_FIELD_GUIDANCE = [
  "- current_price: 最新可用价格，必须与输入中的最新收盘价或实时价一致。",
  "- support: 当前最近支撑位；不存在或当前不适用填 null。",
  "- resistance: 当前最近压力位；不存在或当前不适用填 null。",
  "- breakthrough: 需要放量或收盘确认的向上突破位；不存在或当前不适用填 null。",
  "- stop_loss: 短线止损参考位；不存在或当前不适用填 null。",
  "- take_profit: 短线分批止盈参考位；不存在或当前不适用填 null。",
  "- target: 突破后的第一目标位；不存在或当前不适用填 null。",
  "- round_number: 重要整数关口；不存在或当前不适用填 null。",
  "- gap: 近期未回补的跳空缺口；无明确缺口填 null。",
  "- cost_level: 若提供了用户成本价，必须填写该成本价；未提供则填 null。",
  "- 除 current_price 外，其余价格字段已知则填真实数值，不存在或当前不适用填 null。",
  "- score: 1-10 的整数。",
  "- 最终输出必须是合法 JSON，并用 ```json 代码块包裹，不要输出裸 JSON。",
].join("\n");

export function indentPromptBlock(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
