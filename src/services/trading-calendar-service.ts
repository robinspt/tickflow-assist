import { readFile } from "node:fs/promises";

export type TradingPhase = "non_trading_day" | "pre_market" | "trading" | "lunch_break" | "closed";

export class TradingCalendarService {
  private cache: Set<string> | null = null;

  constructor(private readonly calendarFile: string) {}

  async isTradingDay(date: Date = new Date()): Promise<boolean> {
    const days = await this.loadDays();
    return days.has(this.toChinaDate(date));
  }

  async getTradingPhase(date: Date = new Date()): Promise<TradingPhase> {
    if (!(await this.isTradingDay(date))) {
      return "non_trading_day";
    }

    const china = this.toChinaParts(date);
    const hhmm = `${china.hour}:${china.minute}`;

    if (hhmm < "09:30") {
      return "pre_market";
    }
    if (hhmm <= "11:30") {
      return "trading";
    }
    if (hhmm < "13:00") {
      return "lunch_break";
    }
    if (hhmm <= "15:00") {
      return "trading";
    }
    return "closed";
  }

  async canRunDailyUpdate(date: Date = new Date()): Promise<{ ok: boolean; reason: string }> {
    if (!(await this.isTradingDay(date))) {
      return { ok: false, reason: `${this.toChinaDate(date)} 非交易日` };
    }

    const china = this.toChinaParts(date);
    const hhmm = `${china.hour}:${china.minute}`;
    if (hhmm < "15:30") {
      return { ok: false, reason: `当前 ${hhmm}，须等到 15:30 后执行` };
    }

    return { ok: true, reason: "交易日已收盘" };
  }

  private async loadDays(): Promise<Set<string>> {
    if (this.cache) {
      return this.cache;
    }

    const raw = await readFile(this.calendarFile, "utf-8");
    const days = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    this.cache = new Set(days);
    return this.cache;
  }

  private toChinaDate(date: Date): string {
    const parts = this.toChinaParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  private toChinaParts(date: Date): {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
  } {
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const map = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );

    return {
      year: map.year,
      month: map.month,
      day: map.day,
      hour: map.hour,
      minute: map.minute,
    };
  }
}
