export interface AnalysisStepTask<TInput, TResult> {
  taskName: string;
  prepare(input: TInput): Promise<{ systemPrompt: string; userPrompt: string }> | { systemPrompt: string; userPrompt: string };
  parseResult(analysisText: string, input: TInput): Promise<TResult> | TResult;
}
