export function normalizeSymbol(input: string): string {
  const normalized = input.trim().toUpperCase();

  if (/^\d{6}\.(SH|SZ)$/.test(normalized)) {
    return normalized;
  }

  if (/^\d{6}$/.test(normalized)) {
    if (normalized.startsWith("6") || normalized.startsWith("9")) {
      return `${normalized}.SH`;
    }
    return `${normalized}.SZ`;
  }

  return normalized;
}
