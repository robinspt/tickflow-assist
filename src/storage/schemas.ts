import { Field, Float64, Int64, Schema, Utf8 } from "apache-arrow";

export const watchlistSchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("name", new Utf8(), true),
  new Field("costPrice", new Float64(), false),
  new Field("addedAt", new Utf8(), false),
]);

export const klinesDailySchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("trade_date", new Utf8(), false),
  new Field("timestamp", new Int64(), false),
  new Field("open", new Float64(), false),
  new Field("high", new Float64(), false),
  new Field("low", new Float64(), false),
  new Field("close", new Float64(), false),
  new Field("volume", new Float64(), false),
  new Field("amount", new Float64(), false),
  new Field("prev_close", new Float64(), true),
]);

export const klinesIntradaySchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("period", new Utf8(), false),
  new Field("trade_date", new Utf8(), false),
  new Field("trade_time", new Utf8(), false),
  new Field("timestamp", new Int64(), false),
  new Field("open", new Float64(), false),
  new Field("high", new Float64(), false),
  new Field("low", new Float64(), false),
  new Field("close", new Float64(), false),
  new Field("volume", new Float64(), false),
  new Field("amount", new Float64(), false),
  new Field("prev_close", new Float64(), true),
  new Field("open_interest", new Float64(), true),
  new Field("settlement_price", new Float64(), true),
]);

export const indicatorsSchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("trade_date", new Utf8(), false),
  new Field("ma5", new Float64(), true),
  new Field("ma10", new Float64(), true),
  new Field("ma20", new Float64(), true),
  new Field("ma60", new Float64(), true),
  new Field("macd", new Float64(), true),
  new Field("macd_signal", new Float64(), true),
  new Field("macd_hist", new Float64(), true),
  new Field("kdj_k", new Float64(), true),
  new Field("kdj_d", new Float64(), true),
  new Field("kdj_j", new Float64(), true),
  new Field("rsi_6", new Float64(), true),
  new Field("rsi_12", new Float64(), true),
  new Field("rsi_24", new Float64(), true),
  new Field("cci", new Float64(), true),
  new Field("bias_6", new Float64(), true),
  new Field("bias_12", new Float64(), true),
  new Field("bias_24", new Float64(), true),
  new Field("plus_di", new Float64(), true),
  new Field("minus_di", new Float64(), true),
  new Field("adx", new Float64(), true),
  new Field("boll_upper", new Float64(), true),
  new Field("boll_mid", new Float64(), true),
  new Field("boll_lower", new Float64(), true),
]);

export const keyLevelsSchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("analysis_date", new Utf8(), false),
  new Field("current_price", new Float64(), false),
  new Field("stop_loss", new Float64(), true),
  new Field("breakthrough", new Float64(), true),
  new Field("support", new Float64(), true),
  new Field("cost_level", new Float64(), true),
  new Field("resistance", new Float64(), true),
  new Field("take_profit", new Float64(), true),
  new Field("gap", new Float64(), true),
  new Field("target", new Float64(), true),
  new Field("round_number", new Float64(), true),
  new Field("analysis_text", new Utf8(), false),
  new Field("score", new Int64(), false),
]);

export const analysisLogSchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("analysis_date", new Utf8(), false),
  new Field("analysis_text", new Utf8(), false),
  new Field("structured_ok", new Int64(), false),
]);

export const technicalAnalysisSchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("analysis_date", new Utf8(), false),
  new Field("analysis_text", new Utf8(), false),
  new Field("structured_ok", new Int64(), false),
  new Field("current_price", new Float64(), true),
  new Field("stop_loss", new Float64(), true),
  new Field("breakthrough", new Float64(), true),
  new Field("support", new Float64(), true),
  new Field("cost_level", new Float64(), true),
  new Field("resistance", new Float64(), true),
  new Field("take_profit", new Float64(), true),
  new Field("gap", new Float64(), true),
  new Field("target", new Float64(), true),
  new Field("round_number", new Float64(), true),
  new Field("score", new Int64(), true),
]);

export const financialAnalysisSchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("analysis_date", new Utf8(), false),
  new Field("analysis_text", new Utf8(), false),
  new Field("score", new Int64(), true),
  new Field("bias", new Utf8(), false),
  new Field("strengths_json", new Utf8(), false),
  new Field("risks_json", new Utf8(), false),
  new Field("watch_items_json", new Utf8(), false),
  new Field("evidence_json", new Utf8(), false),
]);

export const newsAnalysisSchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("analysis_date", new Utf8(), false),
  new Field("query", new Utf8(), false),
  new Field("analysis_text", new Utf8(), false),
  new Field("score", new Int64(), true),
  new Field("bias", new Utf8(), false),
  new Field("catalysts_json", new Utf8(), false),
  new Field("risks_json", new Utf8(), false),
  new Field("watch_items_json", new Utf8(), false),
  new Field("source_count", new Int64(), false),
  new Field("evidence_json", new Utf8(), false),
]);

export const compositeAnalysisSchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("analysis_date", new Utf8(), false),
  new Field("analysis_text", new Utf8(), false),
  new Field("structured_ok", new Int64(), false),
  new Field("current_price", new Float64(), true),
  new Field("stop_loss", new Float64(), true),
  new Field("breakthrough", new Float64(), true),
  new Field("support", new Float64(), true),
  new Field("cost_level", new Float64(), true),
  new Field("resistance", new Float64(), true),
  new Field("take_profit", new Float64(), true),
  new Field("gap", new Float64(), true),
  new Field("target", new Float64(), true),
  new Field("round_number", new Float64(), true),
  new Field("score", new Int64(), true),
  new Field("technical_score", new Int64(), true),
  new Field("financial_score", new Int64(), true),
  new Field("news_score", new Int64(), true),
  new Field("financial_bias", new Utf8(), false),
  new Field("news_bias", new Utf8(), false),
  new Field("evidence_json", new Utf8(), false),
]);

export const alertLogSchema = new Schema([
  new Field("symbol", new Utf8(), false),
  new Field("alert_date", new Utf8(), false),
  new Field("rule_name", new Utf8(), false),
  new Field("message", new Utf8(), false),
  new Field("triggered_at", new Utf8(), false),
]);
