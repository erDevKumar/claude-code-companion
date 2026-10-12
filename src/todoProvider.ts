import * as vscode from "vscode";
import { Task, TaskStatus } from "./protocol";

const ICONS: Record<TaskStatus, string> = {
  completed: "pass-filled",
  in_progress: "sync~spin",
  pending: "circle-outline",
};

export class TodoProvider implements vscode.TreeDataProvider<Task> {
  private tasks: Task[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  setTasks(tasks: Task[]): void {
    this.tasks = tasks;
    this.emitter.fire();
  }

  getChildren(element?: Task): Task[] {
    return element ? [] : this.tasks;
  }

  getTreeItem(task: Task): vscode.TreeItem {
    const item = new vscode.TreeItem(task.content, vscode.TreeItemCollapsibleState.None);
    item.id = task.id;
    item.iconPath = new vscode.ThemeIcon(ICONS[task.status] ?? ICONS.pending);
    item.contextValue = task.status;
    item.tooltip = `${task.status.replace("_", " ")}: ${task.content}`;
    if (task.status === "completed") {
      // Strike-through reads as "done" without needing the icon.
      item.description = "done";
    }
    return item;
  }
}
