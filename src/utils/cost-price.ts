export function normalizeCostPrice(value: unknown): number | null {
  const numeric = Number(value ?? NaN);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

export function formatCostPrice(value: number | null | undefined, suffix = ""): string {
  const numeric = normalizeCostPrice(value);
  return numeric == null ? "未设置" : `${numeric.toFixed(2)}${suffix}`;
}

export function calculateProfitPct(
  currentPrice: number,
  costPrice: number | null | undefined,
): number | null {
  const numeric = normalizeCostPrice(costPrice);
  if (numeric == null) {
    return null;
  }
  return ((currentPrice - numeric) / numeric) * 100;
}

export function formatCostRelationship(
  currentPrice: number,
  costPrice: number | null | undefined,
): string {
  const numeric = normalizeCostPrice(costPrice);
  if (numeric == null || !Number.isFinite(currentPrice)) {
    return "未设置";
  }

  const diff = currentPrice - numeric;
  const pct = calculateProfitPct(currentPrice, numeric);
  if (pct == null) {
    return "未设置";
  }

  const direction = diff > 0 ? "高于" : diff < 0 ? "低于" : "持平";
  const diffPrefix = diff > 0 ? "+" : diff < 0 ? "-" : "";
  const pctPrefix = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return `${direction}成本价 ${Math.abs(diff).toFixed(2)} 元（${diffPrefix}${Math.abs(diff).toFixed(2)} 元，${pctPrefix}${Math.abs(pct).toFixed(2)}%）`;
}
