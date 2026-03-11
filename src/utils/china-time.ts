const CHINA_OFFSET_HOURS = 8;

export function chinaNow(): Date {
  return new Date();
}

export function formatChinaDateTime(date: Date = chinaNow()): string {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60_000;
  const chinaDate = new Date(utcMs + CHINA_OFFSET_HOURS * 60 * 60 * 1000);
  const year = chinaDate.getUTCFullYear();
  const month = String(chinaDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(chinaDate.getUTCDate()).padStart(2, "0");
  const hour = String(chinaDate.getUTCHours()).padStart(2, "0");
  const minute = String(chinaDate.getUTCMinutes()).padStart(2, "0");
  const second = String(chinaDate.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function chinaToday(date: Date = chinaNow()): string {
  return formatChinaDateTime(date).slice(0, 10);
}
