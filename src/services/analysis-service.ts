import { formatConfigEnvFallback } from "../config/env.js";
import { AnalysisTask } from "../analysis/tasks/analysis-task.js";
import { AnalysisLogRepository } from "../storage/repositories/analysis-log-repo.js";
import type { AnalysisLogEntry } from "../types/domain.js";

export interface GenerateTextOptions {
  maxTokens?: number;
  temperature?: number;
}

export class AnalysisService {
  constructor(
    private readonly llmBaseUrl: string,
    private readonly llmApiKey: string,
    private readonly llmModel: string,
    private readonly analysisLogRepository: AnalysisLogRepository,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.llmBaseUrl.trim() && this.llmApiKey.trim() && this.llmModel.trim());
  }

  getConfigurationError(): string | null {
    if (!this.llmBaseUrl.trim()) {
      return `LLM 未配置接口地址，请设置 llmBaseUrl 或环境变量 ${formatConfigEnvFallback("llmBaseUrl")}`;
    }
    if (!this.llmApiKey.trim()) {
      return `LLM 未配置 API Key，请设置 llmApiKey 或环境变量 ${formatConfigEnvFallback("llmApiKey")}`;
    }
    if (!this.llmModel.trim()) {
      return `LLM 未配置模型，请设置 llmModel 或环境变量 ${formatConfigEnvFallback("llmModel")}`;
    }
    return null;
  }

  async runTask<TInput, TResult>(task: AnalysisTask<TInput, TResult>, input: TInput): Promise<TResult> {
    const prepared = await task.prepare(input);
    const analysisText = await this.generateText(prepared.systemPrompt, prepared.userPrompt);
    const result = await task.parseResult(analysisText, input);
    await task.persistResult(result, input);
    return result;
  }

  async generateText(
    systemPrompt: string,
    userPrompt: string,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.callLlm(systemPrompt, userPrompt, options);
  }

  async getLatestAnalysis(symbol: string): Promise<AnalysisLogEntry | null> {
    return this.analysisLogRepository.getLatest(symbol);
  }

  private async callLlm(
    systemPrompt: string,
    userPrompt: string,
    options: GenerateTextOptions,
  ): Promise<string> {
    const configError = this.getConfigurationError();
    if (configError) {
      throw new Error(configError);
    }

    const url = new URL("/chat/completions", this.llmBaseUrl).toString();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.llmApiKey}`,
      },
      body: JSON.stringify({
        model: this.llmModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.3,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM analyze request failed: ${response.status} ${response.statusText} ${text}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM analyze response content is empty");
    }
    return content;
  }
}
