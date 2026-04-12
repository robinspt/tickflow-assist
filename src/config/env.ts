export const CONFIG_ENV_FALLBACKS = {
  tickflowApiUrl: ["TICKFLOW_ASSIST_TICKFLOW_API_URL", "TICKFLOW_API_URL"],
  tickflowApiKey: ["TICKFLOW_ASSIST_TICKFLOW_API_KEY", "TICKFLOW_API_KEY"],
  tickflowApiKeyLevel: ["TICKFLOW_ASSIST_TICKFLOW_API_KEY_LEVEL", "TICKFLOW_API_KEY_LEVEL"],
  mxSearchApiUrl: ["TICKFLOW_ASSIST_MX_SEARCH_API_URL", "MX_SEARCH_API_URL"],
  mxSearchApiKey: ["TICKFLOW_ASSIST_MX_SEARCH_API_KEY", "MX_SEARCH_API_KEY", "MX_APIKEY"],
  jin10McpUrl: ["TICKFLOW_ASSIST_JIN10_MCP_URL", "JIN10_MCP_URL"],
  jin10ApiToken: ["TICKFLOW_ASSIST_JIN10_API_TOKEN", "JIN10_API_TOKEN"],
  llmBaseUrl: ["TICKFLOW_ASSIST_LLM_BASE_URL", "LLM_BASE_URL"],
  llmApiKey: ["TICKFLOW_ASSIST_LLM_API_KEY", "LLM_API_KEY"],
  llmModel: ["TICKFLOW_ASSIST_LLM_MODEL", "LLM_MODEL"],
} as const;

export type EnvBackedConfigKey = keyof typeof CONFIG_ENV_FALLBACKS;

export function getEnvFallbackValue(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function getConfigEnvFallback(
  key: EnvBackedConfigKey,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return getEnvFallbackValue(CONFIG_ENV_FALLBACKS[key], env);
}

export function hasConfigEnvFallback(
  key: EnvBackedConfigKey,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(getConfigEnvFallback(key, env));
}

export function formatConfigEnvFallback(key: EnvBackedConfigKey): string {
  return CONFIG_ENV_FALLBACKS[key].join(" / ");
}
