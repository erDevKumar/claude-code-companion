import * as os from "os";
import * as path from "path";

/** Socket both the bridge and the extension agree on. Keep this the only definition. */
export const SOCKET_PATH =
  process.platform === "win32"
    ? "\\\\.\\pipe\\claude-vscode-progress"
    : path.join(os.tmpdir(), "claude-vscode-progress.sock");

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface Task {
  /** Stable id across pushes; falls back to content when absent. */
  id?: string;
  content: string;
  status: TaskStatus;
}

export interface Payload {
  sessionId?: string;
  model?: string;
  tasks?: Task[];
  /** Optional overrides; otherwise derived from `tasks`. */
  completed?: number;
  total?: number;
  rate_limits?: {
    five_hour?: { used_percentage?: number; resets_at?: number };
    seven_day?: { used_percentage?: number; resets_at?: number };
  };
  context_window?: { used_percentage?: number };
}
