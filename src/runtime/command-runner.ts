import type { OpenClawPluginRuntime } from "./plugin-api.js";

export interface CommandRunResult {
  pid?: number;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  killed: boolean;
  termination: "exit" | "timeout" | "no-output-timeout" | "signal";
  noOutputTimedOut?: boolean;
}

export interface CommandRunOptions {
  timeoutMs: number;
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
  noOutputTimeoutMs?: number;
}

export type RunCommandWithTimeout = (
  argv: string[],
  options: number | CommandRunOptions,
) => Promise<CommandRunResult>;

let localRunnerPromise: Promise<RunCommandWithTimeout> | null = null;

async function loadLocalRunner(): Promise<RunCommandWithTimeout> {
  localRunnerPromise ??= import("openclaw/plugin-sdk/process-runtime")
    .then((module) => module.runCommandWithTimeout as RunCommandWithTimeout)
    .catch((error) => {
      localRunnerPromise = null;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        "OpenClaw command runner is unavailable outside plugin runtime. " +
          "For source-mode local commands, run `npm install` with devDependencies " +
          `or execute the feature through OpenClaw. Details: ${detail}`,
      );
    });
  return localRunnerPromise;
}

export function createCommandRunner(runtime?: OpenClawPluginRuntime): RunCommandWithTimeout {
  if (runtime) {
    return runtime.system.runCommandWithTimeout;
  }

  return async (argv, options) => {
    const runner = await loadLocalRunner();
    return runner(argv, options);
  };
}
