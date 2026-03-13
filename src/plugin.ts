import type { PluginApi } from "./runtime/plugin-api.js";
import { normalizePluginConfig, validatePluginConfig } from "./config/normalize.js";
import { createAppContext } from "./bootstrap.js";

export default async function registerTickFlowAssist(api: PluginApi): Promise<void> {
  const config = normalizePluginConfig(api.config ?? {});
  const errors = validatePluginConfig(config);

  if (errors.length > 0) {
    api.log?.warn?.("tickflow-assist config is incomplete", { errors });
  }

  const app = createAppContext(config, {
    configSource: "openclaw_plugin",
    pluginManagedServices: typeof api.registerService === "function",
  });

  api.log?.info?.("tickflow-assist plugin loaded", {
    tickflowApiKeyLevel: config.tickflowApiKeyLevel,
    calendarFile: config.calendarFile,
    requestInterval: config.requestInterval,
    alertChannel: config.alertChannel,
    databasePath: config.databasePath,
    pluginManagedServices: app.runtime.pluginManagedServices,
  });

  for (const tool of app.tools) {
    api.registerTool?.(tool);
  }

  for (const service of app.backgroundServices) {
    api.registerService?.(service);
  }
}
