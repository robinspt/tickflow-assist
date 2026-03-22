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
