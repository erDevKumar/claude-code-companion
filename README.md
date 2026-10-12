# Claude Code Companion

A VS Code extension that surfaces a local [Claude Code](https://claude.com/claude-code)
session in the editor: task progress with an ETA, 5-hour rate-limit quota, and a
task list in the Explorer.

Claude Code's `statusLine` command gets the session JSON on stdin. A small bridge
script forwards it over a Unix domain socket (named pipe on Windows) to the
extension, which renders it. No polling, no file locking.

```
Claude Code ──stdin──> claude-bridge.js ──socket──> extension ──> status bar + tree
```

## Install

```sh
git clone https://github.com/erDevKumar/claude-code-companion
cd claude-code-companion
npm install && npm run compile
ln -s "$PWD" ~/.vscode/extensions/claude-code-companion
```

Reload the VS Code window. The extension activates on `onStartupFinished`.

## Configure

Add to `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "node /abs/path/to/claude-code-companion/scripts/claude-bridge.js",
  "refreshInterval": 10
}
```

`refreshInterval` keeps the "resets in" countdown from going stale, since
`statusLine` otherwise only re-runs on session events.

## Task feed (optional)

`statusLine` carries no task data, so tasks come from a file you point
`CLAUDE_COMPANION_TASKS` at:

```json
{"tasks": [
  {"content": "Wire IPC", "status": "completed"},
  {"content": "Verify on device", "status": "in_progress"},
  {"content": "Ship", "status": "pending"}
]}
```

The bridge re-reads it on every refresh and ignores it if missing or malformed.

## Limitations

- **Tasks are an external feed.** Claude Code's `statusLine` payload has no
  task/todo fields, so the progress bar and tree stay hidden until something
  writes that file.
- **Quota needs a subscription.** `rate_limits` is only present for claude.ai
  Pro/Max (or behind a gateway with spend limits), and only after the first API
  response. The quota item hides rather than showing zeros.
- **ETA needs two data points.** The EMA (alpha 0.3) samples wall-clock time per
  completed task and only advances on a rising count, so repeated refreshes with
  no progress can't decay it toward zero. No ETA shows until one task completes.

## Develop

```sh
npm run watch
node src/etaEstimator.test.js   # self-check, needs a compile first
```

## License

MIT
