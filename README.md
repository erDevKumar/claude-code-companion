# Claude Code Companion

A VS Code extension that surfaces a local [Claude Code](https://claude.com/claude-code)
session in the editor: task progress with a live ETA, your 5-hour rate-limit quota,
and a task list in the Explorer.

<img src="docs/status-bar.png" alt="Status bar showing task progress with ETA and quota" width="543">

> Real screenshots of the extension running in VS Code.

## What you get

### 1. Task progress bar (bottom-left status bar)

<img src="docs/status-tasks.png" alt="Task progress status bar item" width="228">

- `[4/5] 80%` — completed / total and percentage, with a spinner while work is running
- `(~3s left)` — a live ETA from an exponential moving average of how long your
  recent tasks took, so it settles instead of jumping around
- Turns into `✓ [5/5] 100%` when everything completes
- **Hover** shows the full task list; **click** opens the Explorer

### 2. Quota bar (next to it)

<img src="docs/status-quota.png" alt="Quota status bar item" width="311">

- Your claude.ai **5-hour rate-limit window**: percent used and time until reset
- Background turns **orange at 75%**, **red at 90%** — glanceable before you hit the wall
- **Hover** shows the 7-day window too
- Works with zero setup beyond the bridge; data comes straight from Claude Code

### 3. "Claude Tasks" in the Explorer sidebar

<img src="docs/tasks-view.png" alt="Claude Tasks tree view in the Explorer" width="650">

- Every task with a live status icon: ✓ completed, spinner for in-progress, ○ pending
- Updates in real time as payloads arrive — no refresh button, no polling

## How it works

<img src="docs/how-it-works.png" alt="Data flow: Claude Code statusLine to bridge script to IPC socket to extension" width="1480">

Claude Code runs your configured `statusLine` command on every session event and
pipes it session JSON on stdin. The bridge prints a terminal status line (so your
terminal still gets one) and forwards the payload over a local IPC socket — a Unix
domain socket at `$TMPDIR/claude-vscode-progress.sock`, a named pipe on Windows.
The extension listens, computes the ETA, and drives all three UI pieces. Nothing is
polled and nothing is written to disk.

## Install

```sh
git clone https://github.com/erDevKumar/claude-code-companion
cd claude-code-companion
npm install && npm run compile
ln -s "$PWD" ~/.vscode/extensions/claude-code-companion
```

Reload the VS Code window (`Cmd+Shift+P` → **Developer: Reload Window**). The
extension activates on startup; **Output → Claude Companion** should log
`Listening on …/claude-vscode-progress.sock`.

## Configure Claude Code

Add to `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "node /abs/path/to/claude-code-companion/scripts/claude-bridge.js",
  "refreshInterval": 10
}
```

`refreshInterval` matters: without it the status line only re-runs on session
events, so the "resets in" countdown and ETA go stale between them.

## Use it

**1. Start a Claude Code session in a terminal.** After the first API response the
quota bar appears. That is the entire setup for quota tracking.

The bars are driven by the `statusLine` command, which Claude Code only runs for
**terminal** sessions. A session running inside the VS Code extension does not
invoke it, so nothing will appear from that alone.

**2. Feed tasks (optional).** Claude Code's `statusLine` payload carries no task
data, so tasks come from a JSON file you point `CLAUDE_COMPANION_TASKS` at:

```json
{"tasks": [
  {"content": "Wire IPC socket",  "status": "completed"},
  {"content": "Verify on device", "status": "in_progress"},
  {"content": "Ship",             "status": "pending"}
]}
```

Export it where Claude Code runs, e.g. in `~/.zshrc`:

```sh
export CLAUDE_COMPANION_TASKS=~/.claude/companion-tasks.json
```

The bridge re-reads the file on every refresh and ignores it when missing or
malformed. Anything that writes this file — a hook, a script, your own agent —
drives the progress bar and the tree. Statuses are `pending`, `in_progress`,
`completed`.

**3. Read the bar.** The ETA appears once the first task completes (the average
needs one real interval) and only advances when the completed count rises, so
idle refreshes cannot decay it toward zero. With an empty or absent list, the task
bar and tree hide rather than showing zeros.

### Push a test payload by hand

No Claude session needed — talk to the socket directly:

```sh
node -e '
const net = require("net"), os = require("os");
const payload = {
  model: { display_name: "Opus" },
  rate_limits: { five_hour: { used_percentage: 42, resets_at: Math.floor(Date.now()/1000) + 7200 } },
  tasks: [
    { content: "Wire IPC socket",  status: "completed" },
    { content: "Verify on device", status: "in_progress" },
    { content: "Ship",             status: "pending" },
  ],
};
net.connect(os.tmpdir() + "/claude-vscode-progress.sock")
   .end(JSON.stringify(payload) + "\n");
'
```

The payload must arrive as **one line** — the socket is newline-delimited, so a
pretty-printed JSON blob is read as several broken frames.

## Troubleshooting

- **Nothing in the status bar** — the bars hide when they have no data. Check
  **Output → Claude Companion** for the `Listening on …` line, then confirm the
  path in your `statusLine` command. Zen Mode also hides the status bar entirely.
- **Quota never appears** — `rate_limits` is only sent to claude.ai Pro/Max
  subscribers (or behind a gateway with spend limits), and only after the first
  API response of a session.
- **Two VS Code windows** — one window owns the socket; the other logs
  `Socket already served by another window` and stays idle rather than stealing it.
- **No ETA yet** — it needs one completed task to measure. `[0/5] 0%` with no ETA
  is correct at the start.

## Develop

```sh
npm run watch
node src/etaEstimator.test.js   # self-check, compile first
```

## License

MIT
