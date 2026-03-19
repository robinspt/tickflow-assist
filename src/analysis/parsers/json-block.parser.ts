export function parseJsonBlock<T>(responseText: string): T | null {
  const fenced = responseText.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? responseText.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) {
    return null;
  }

  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}
