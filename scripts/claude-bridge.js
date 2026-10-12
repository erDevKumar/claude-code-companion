#!/usr/bin/env node
/**
 * Claude Code statusLine bridge.
 *
 * Reads the session JSON Claude Code writes to stdin, forwards it to the
 * VS Code extension's IPC socket, and prints a status line.
 *
 * Must never block: the socket write is fire-and-forget behind a short timeout
 * so a closed VS Code can't stall Claude Code's UI. Printing happens first,
 * and exactly once, whatever the socket does.
 *
 * Configure in ~/.claude/settings.json:
 *   "statusLine": { "type": "command", "command": "node /abs/path/scripts/claude-bridge.js" }
 */
const net = require("net");
const os = require("os");
const path = require("path");

const SOCKET_PATH =
  process.platform === "win32"
    ? "\\\\.\\pipe\\claude-vscode-progress"
    : path.join(os.tmpdir(), "claude-vscode-progress.sock");

const TASKS_FILE = process.env.CLAUDE_COMPANION_TASKS; // optional task feed

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let data = {};
  try { data = JSON.parse(raw) || {}; } catch { /* print a line anyway */ }

  const payload = {
    sessionId: data.session_id,
    model: data.model && data.model.display_name,
    rate_limits: data.rate_limits,
    context_window: data.context_window,
    tasks: readTasks(),
  };

  // stdout first: the status line must render even if the socket is dead.
  process.stdout.write(render(data, payload) + "\n");
  send(payload);
});

/**
 * No task data exists in the statusLine payload, so tasks come from an
 * optional external file: {"tasks":[{"content":"...","status":"pending"}]}
 * or a bare array. Anything else is ignored silently.
 */
function readTasks() {
  if (!TASKS_FILE) return undefined;
  try {
    const parsed = JSON.parse(require("fs").readFileSync(TASKS_FILE, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.tasks;
    return Array.isArray(list) ? list : undefined;
  } catch {
    return undefined;
  }
}

function render(data, payload) {
  const parts = [];
  if (payload.model) parts.push(`[${payload.model}]`);

  const ctx = data.context_window && data.context_window.used_percentage;
  if (ctx != null) parts.push(`ctx ${Math.round(ctx)}%`);

  const five = data.rate_limits && data.rate_limits.five_hour;
  if (five && five.used_percentage != null) parts.push(`5h ${Math.round(five.used_percentage)}%`);

  const t = payload.tasks;
  if (t && t.length) {
    const done = t.filter((x) => x.status === "completed").length;
    parts.push(`${done}/${t.length}`);
  }
  return parts.join(" | ") || "claude";
}

function send(payload) {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    try { sock.destroy(); } catch {}
    process.exit(0);
  };

  const sock = net.connect(SOCKET_PATH);
  sock.on("connect", () => sock.end(JSON.stringify(payload) + "\n", finish));
  sock.on("error", finish);   // VS Code not running — not an error worth reporting
  setTimeout(finish, 250).unref();
}
