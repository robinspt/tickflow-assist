import { AnalysisTask } from "../analysis/tasks/analysis-task.js";
import { AnalysisLogRepository } from "../storage/repositories/analysis-log-repo.js";
import type { AnalysisLogEntry } from "../types/domain.js";

export class AnalysisService {
  constructor(
    private readonly llmBaseUrl: string,
    private readonly llmApiKey: string,
    private readonly llmModel: string,
    private readonly analysisLogRepository: AnalysisLogRepository,
  ) {}

  async runTask<TInput, TResult>(task: AnalysisTask<TInput, TResult>, input: TInput): Promise<TResult> {
    const prepared = await task.prepare(input);
    const analysisText = await this.generateText(prepared.systemPrompt, prepared.userPrompt);
    const result = await task.parseResult(analysisText, input);
    await task.persistResult(result, input);
    return result;
  }

  async generateText(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.callLlm(systemPrompt, userPrompt);
  }

  async getLatestAnalysis(symbol: string): Promise<AnalysisLogEntry | null> {
    return this.analysisLogRepository.getLatest(symbol);
  }

  private async callLlm(systemPrompt: string, userPrompt: string): Promise<string> {
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
        max_tokens: 4096,
        temperature: 0.3,
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
