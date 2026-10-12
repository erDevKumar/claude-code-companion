import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import { SOCKET_PATH, Payload, Task } from "./protocol";
import { StatusBarManager } from "./statusBar";
import { TodoProvider } from "./todoProvider";

let server: net.Server | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel("Claude Companion");
  const bars = new StatusBarManager();
  const todos = new TodoProvider();

  context.subscriptions.push(
    out,
    bars,
    vscode.window.registerTreeDataProvider("claudeTasksView", todos),
    vscode.commands.registerCommand("claudeCompanion.showSocketPath", () => {
      vscode.window.showInformationMessage(`Claude Companion socket: ${SOCKET_PATH}`);
    }),
  );

  const onPayload = (p: Payload) => {
    bars.update(p);
    if (p.tasks) {
      todos.setTasks(p.tasks.map(normalize));
    }
  };

  start(onPayload, out).then((s) => {
    server = s;
    context.subscriptions.push({ dispose: () => stop() });
  });
}

export function deactivate(): void {
  stop();
}

async function start(
  onPayload: (p: Payload) => void,
  out: vscode.OutputChannel,
): Promise<net.Server | undefined> {
  await clearStaleSocket(out);

  const s = net.createServer((conn) => {
    let buf = "";
    conn.setEncoding("utf8");
    conn.on("data", (chunk: string) => {
      buf += chunk;
      // Newline-delimited JSON: a stream gives no message boundaries of its own.
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handleLine(line, onPayload, out);
      }
      // Guard against a peer that never sends a newline.
      if (buf.length > 1_000_000) {
        out.appendLine("Dropping oversized frame without newline");
        buf = "";
        conn.destroy();
      }
    });
    conn.on("end", () => {
      const line = buf.trim();
      if (line) handleLine(line, onPayload, out);
    });
    conn.on("error", (e) => out.appendLine(`Connection error: ${e.message}`));
  });

  s.on("error", (e) => out.appendLine(`Server error: ${e.message}`));

  return new Promise((resolve) => {
    s.listen(SOCKET_PATH, () => {
      out.appendLine(`Listening on ${SOCKET_PATH}`);
      resolve(s);
    });
    s.on("error", () => resolve(undefined));
  });
}

function handleLine(line: string, onPayload: (p: Payload) => void, out: vscode.OutputChannel): void {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object") {
      onPayload(parsed as Payload);
    }
  } catch (e) {
    // A malformed push must never take the extension host down.
    out.appendLine(`Bad payload: ${(e as Error).message}`);
  }
}

/**
 * Remove a socket left behind by a crash — but never one a live server owns,
 * which would silently steal the endpoint from another window.
 */
async function clearStaleSocket(out: vscode.OutputChannel): Promise<void> {
  if (process.platform === "win32") return; // named pipes clean themselves up
  if (!fs.existsSync(SOCKET_PATH)) return;

  const alive = await new Promise<boolean>((resolve) => {
    const probe = net.connect(SOCKET_PATH);
    const done = (v: boolean) => { probe.destroy(); resolve(v); };
    probe.on("connect", () => done(true));
    probe.on("error", () => done(false));
    setTimeout(() => done(false), 300);
  });

  if (alive) {
    out.appendLine(`Socket already served by another window; this one stays idle.`);
    return;
  }
  try {
    fs.unlinkSync(SOCKET_PATH);
    out.appendLine("Removed stale socket");
  } catch (e) {
    out.appendLine(`Could not remove stale socket: ${(e as Error).message}`);
  }
}

function stop(): void {
  server?.close();
  server = undefined;
  if (process.platform !== "win32") {
    try { fs.unlinkSync(SOCKET_PATH); } catch { /* already gone */ }
  }
}

function normalize(t: Task): Task {
  return { id: t.id ?? t.content, content: t.content, status: t.status ?? "pending" };
}
