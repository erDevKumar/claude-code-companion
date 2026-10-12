import * as vscode from "vscode";
import { EtaEstimator, formatDuration } from "./etaEstimator";
import { Payload } from "./protocol";

export class StatusBarManager implements vscode.Disposable {
  private readonly tasks: vscode.StatusBarItem;
  private readonly quota: vscode.StatusBarItem;
  private readonly eta = new EtaEstimator();

  constructor() {
    this.tasks = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.tasks.command = "workbench.view.explorer";
    this.quota = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  }

  update(p: Payload): void {
    this.renderTasks(p);
    this.renderQuota(p);
  }

  private renderTasks(p: Payload): void {
    const list = p.tasks ?? [];
    const total = p.total ?? list.length;
    const completed = p.completed ?? list.filter((t) => t.status === "completed").length;

    if (total <= 0) {
      this.tasks.hide();
      return;
    }

    this.eta.update(completed, total);
    const pct = Math.round((completed / total) * 100);
    const done = completed >= total;
    const icon = done ? "$(check)" : "$(sync~spin)";

    const ms = this.eta.remainingMs(completed, total);
    const suffix = done ? "" : ms === undefined ? "" : ` (~${formatDuration(ms)} left)`;

    this.tasks.text = `${icon} [${completed}/${total}] ${pct}%${suffix}`;
    this.tasks.tooltip = list.length
      ? list.map((t) => `${glyph(t.status)} ${t.content}`).join("\n")
      : `${completed} of ${total} complete`;
    this.tasks.show();
  }

  private renderQuota(p: Payload): void {
    const five = p.rate_limits?.five_hour;
    // Absent for non-subscribers and before the first API response — stay hidden.
    if (five?.used_percentage === undefined) {
      this.quota.hide();
      return;
    }
    const used = Math.round(five.used_percentage);
    const resets = resetsIn(five.resets_at);

    this.quota.text = `$(dashboard) Quota: ${used}%${resets ? ` (resets in ${resets})` : ""}`;
    this.quota.backgroundColor =
      used >= 90 ? new vscode.ThemeColor("statusBarItem.errorBackground")
      : used >= 75 ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;

    const week = p.rate_limits?.seven_day?.used_percentage;
    this.quota.tooltip =
      `5-hour window: ${used}% used` +
      (week !== undefined ? `\n7-day window: ${Math.round(week)}% used` : "");
    this.quota.show();
  }

  dispose(): void {
    this.tasks.dispose();
    this.quota.dispose();
  }
}

/** `resets_at` is Unix epoch *seconds*. */
function resetsIn(resetsAt?: number): string | undefined {
  if (!resetsAt) return undefined;
  const ms = resetsAt * 1000 - Date.now();
  return ms > 0 ? formatDuration(ms) : undefined;
}

function glyph(s: string): string {
  return s === "completed" ? "✓" : s === "in_progress" ? "▶" : "○";
}
