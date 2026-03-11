---
name: stock_analysis
description: Analyze A-share watchlist symbols, update daily K-line data, run monitor, and report status through the TickFlow Assist plugin.
metadata:
  openclaw:
    skillKey: stock_analysis
    requires:
      config: true
---
# Stock Analysis

Use the TickFlow Assist plugin tools for:
- adding and removing watchlist symbols
- updating daily K-line data
- running technical analysis
- starting and stopping realtime monitoring
- checking monitor status
- viewing the latest saved analysis

Constraints:
- Prefer plugin tools over shell commands.
- For `start_monitor`, `stop_monitor`, `monitor_status`, `analyze`, `view_analysis`, `fetch_klines`, and `update_all`, call the tool and output the returned text verbatim.
- Do not rewrite, summarize, translate, reorder, prettify, or wrap tool output in tables or extra headings.
- Do not add follow-up questions, commentary, or inferred fields after a tool call unless the tool itself returned an explicit error.
- Do not summarize away key numeric fields.
- This skill is intended to load from the plugin bundle, not from manual workspace copying.
- When the host supports plugin background services, treat monitor start/stop as controlling the bundled plugin services rather than spawning ad-hoc shell processes.
