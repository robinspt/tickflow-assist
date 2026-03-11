# TickFlow Assist Beta Release Checklist

## Build

```bash
cd /path/to/tickflow-assist-beta
npm install
npm run check
npm run build
```

## Plugin Install

```bash
openclaw plugins install -l /path/to/tickflow-assist-beta
openclaw plugins enable tickflow-assist
openclaw plugins info tickflow-assist
openclaw plugins doctor
openclaw gateway restart
```

## Config

Confirm `~/.openclaw/openclaw.json` contains:
- `plugins.enabled: true`
- `plugins.entries.tickflow-assist.enabled: true`
- `plugins.entries.tickflow-assist.config.tickflowApiKey`
- `plugins.entries.tickflow-assist.config.llmApiKey`
- `plugins.entries.tickflow-assist.config.alertTarget`
- correct absolute paths for `databasePath`, `calendarFile`, and `pythonWorkdir`

## Functional Verification

Run and verify:

```bash
npm run tool -- test_alert
npm run tool -- list_watchlist
npm run tool -- fetch_klines '{"symbol":"002261","count":90}'
npm run tool -- analyze '{"symbol":"002261"}'
npm run tool -- view_analysis '{"symbol":"002261"}'
npm run tool -- start_monitor
npm run tool -- monitor_status
npm run tool -- stop_monitor
npm run tool -- update_all
```

Expected:
- active messages reach the target Telegram chat
- watchlist names are stored and displayed correctly
- daily K-line end date matches the East Asia trading date
- analysis output can be replayed from storage
- manual stop sends only the stop notification, not an extra exit-notification
- manual `start_monitor` and `stop_monitor` should not create a second proactive lifecycle message in the same chat
- `monitor_status` reports `运行方式: plugin_service ...` when the host actually starts the plugin background service

## Background Services

Primary path:
- OpenClaw host exposes `registerService`
- plugin registers `tickflow-assist.realtime-monitor`
- plugin registers `tickflow-assist.daily-update`
- after Gateway startup, `monitor_status` should show `运行方式: plugin_service`

Fallback path:
- if the host runtime does not yet expose plugin background-service registration, use:

```bash
npm run monitor-loop
```

This fallback is for development or VPS verification only, not the preferred Gateway hosting path.
