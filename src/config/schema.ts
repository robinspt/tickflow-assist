import type { TickflowApiKeyLevel } from "./tickflow-access.js";

export interface PluginConfig {
  tickflowApiUrl: string;
  tickflowApiKey: string;
  tickflowApiKeyLevel: TickflowApiKeyLevel;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  databasePath: string;
  calendarFile: string;
  requestInterval: number;
  dailyUpdateNotify: boolean;
  alertChannel: string;
  openclawCliBin: string;
  alertAccount: string;
  alertTarget: string;
  pythonBin: string;
  pythonArgs: string[];
  pythonWorkdir: string;
}

export const DEFAULT_PLUGIN_CONFIG: Omit<
  PluginConfig,
  "tickflowApiKey" | "llmApiKey" | "alertTarget"
> = {
  tickflowApiUrl: "https://api.tickflow.org",
  tickflowApiKeyLevel: "free",
  llmBaseUrl: "https://api.openai.com/v1",
  llmModel: "gpt-4o",
  databasePath: "./data/lancedb",
  calendarFile: "./day_future.txt",
  requestInterval: 30,
  dailyUpdateNotify: false,
  alertChannel: "telegram",
  openclawCliBin: "openclaw",
  alertAccount: "",
  pythonBin: "uv",
  pythonArgs: ["run", "python"],
  pythonWorkdir: "./python",
};
