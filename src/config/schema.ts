export interface PluginConfig {
  tickflowApiUrl: string;
  tickflowApiKey: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  databasePath: string;
  calendarFile: string;
  requestInterval: number;
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
  llmBaseUrl: "https://api.openai.com/v1",
  llmModel: "gpt-4o",
  databasePath: "./data/lancedb",
  calendarFile: "./day_future.txt",
  requestInterval: 30,
  alertChannel: "telegram",
  openclawCliBin: "openclaw",
  alertAccount: "",
  pythonBin: "uv",
  pythonArgs: ["run", "python"],
  pythonWorkdir: "./python",
};
