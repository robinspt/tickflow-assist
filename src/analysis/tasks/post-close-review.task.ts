import { formatChinaDateTime } from "../../utils/china-time.js";
import {
  POST_CLOSE_REVIEW_SYSTEM_PROMPT,
  buildPostCloseReviewUserPrompt,
} from "../../prompts/analysis/index.js";
import { validateKeyLevels } from "../parsers/key-levels.parser.js";
import { parsePostCloseReviewPayload } from "../parsers/post-close-review.parser.js";
import type { AnalysisTask } from "./analysis-task.js";
import type { PostCloseReviewInput, PostCloseReviewResult } from "../types/composite-analysis.js";

export class PostCloseReviewTask implements AnalysisTask<PostCloseReviewInput, PostCloseReviewResult> {
  readonly taskName = "post_close_review";

  prepare(input: PostCloseReviewInput): { systemPrompt: string; userPrompt: string } {
    return {
      systemPrompt: POST_CLOSE_REVIEW_SYSTEM_PROMPT,
      userPrompt: buildPostCloseReviewUserPrompt(input),
    };
  }

  parseResult(analysisText: string, input: PostCloseReviewInput): PostCloseReviewResult {
    const payload = parsePostCloseReviewPayload(analysisText);
    const fallbackLevels = input.compositeResult.levels ?? input.technicalResult.levels ?? null;
    const levels = payload.levels ?? (payload.decision === "invalidate" ? null : fallbackLevels);

    if (levels) {
      levels.symbol = input.market.symbol;
      levels.analysis_date = formatChinaDateTime().slice(0, 10);
      levels.analysis_text = analysisText;
      validateKeyLevels(levels);
    }

    return {
      analysisText: analysisText.trim(),
      ...payload,
      levels,
    };
  }

  async persistResult(): Promise<void> {
    // Persisting key levels and snapshots is handled by PostCloseReviewService.
  }

  formatForUser(result: PostCloseReviewResult): string {
    return result.analysisText;
  }
}
