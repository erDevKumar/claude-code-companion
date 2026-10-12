import * as vscode from "vscode";
import { Confidence, EtaEstimator, formatDuration } from "./etaEstimator";
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

    const est = done ? undefined : this.eta.estimate(completed, total);
    // "~" and a rounded figure already read as approximate; "?" marks the ones
    // built on too few or too erratic samples to lean on.
    const suffix = est ? ` (~${formatDuration(est.ms)} left${est.confidence === "rough" ? "?" : ""})` : "";

    this.tasks.text = `${icon} [${completed}/${total}] ${pct}%${suffix}`;

    const lines = list.length
      ? list.map((t) => `${glyph(t.status)} ${t.content}`)
      : [`${completed} of ${total} complete`];
    this.tasks.tooltip = [...lines, "", etaNote(est)].join("\n");
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

/**
 * The disclaimer. The ETA is a projection from past task durations, never a
 * schedule, so the tooltip says so plainly and reports what it is based on.
 */
function etaNote(est: { confidence: Confidence; samples: number } | undefined): string {
  if (!est) {
    return "ETA: not yet — it needs one completed task to measure.";
  }
  const basis = `${est.samples} completed task${est.samples === 1 ? "" : "s"}`;
  const grade: Record<Confidence, string> = {
    rough: "rough guess",
    fair: "fair estimate",
    good: "steady pace",
    none: "estimate",
  };
  return [
    `ETA: estimated, not exact (${grade[est.confidence]}, from ${basis}).`,
    "It projects your recent pace onto the remaining tasks and gets more",
    "accurate the longer the session runs.",
  ].join("\n");
}

function glyph(s: string): string {
  return s === "completed" ? "✓" : s === "in_progress" ? "▶" : "○";
}
