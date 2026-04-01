import * as child_process from "child_process";
import * as vscode from "vscode";

export interface CommandRunnerOptions {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  stdin?: string;
  signal?: AbortSignal;
  env?: Record<string, string>;
  /** Override the per-call output byte cap (defaults to config myAi.tools.commandOutputMaxBytes). */
  maxOutputBytes?: number;
}

export interface CommandRunnerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OUTPUT_MAX_BYTES = 8192;

function truncateOutput(raw: string, maxBytes: number): string {
  if (Buffer.byteLength(raw, "utf8") <= maxBytes) return raw;
  const buf = Buffer.from(raw, "utf8");
  const sliced = buf.subarray(0, maxBytes).toString("utf8");
  const dropped = Buffer.byteLength(raw, "utf8") - maxBytes;
  return `${sliced}\n\n...[truncated ${dropped} bytes]`;
}

/**
 * Spawns a shell command and captures stdout + stderr.
 *
 * Unlike `runTerminal` (which fires into a VS Code terminal with no output
 * capture), this uses `child_process.spawn` so the agent can actually read
 * the command's output and react to it.
 */
export function runCommand(opts: CommandRunnerOptions): Promise<CommandRunnerResult> {
  const cfg = vscode.workspace.getConfiguration();
  const maxBytes = opts.maxOutputBytes ?? cfg.get<number>("myAi.tools.commandOutputMaxBytes", DEFAULT_OUTPUT_MAX_BYTES);
  const timeoutMs = opts.timeoutMs ?? cfg.get<number>("myAi.tools.commandTimeoutMs", DEFAULT_TIMEOUT_MS);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cwd = opts.cwd || workspaceRoot || process.cwd();

  return new Promise((resolve) => {
    const start = Date.now();
    let timedOut = false;
    let killed = false;

    const proc = child_process.spawn(opts.command, {
      cwd,
      shell: true,
      detached: true,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    if (opts.stdin !== undefined && proc.stdin) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    } else {
      proc.stdin?.end();
    }

    const killTree = (sig: NodeJS.Signals) => {
      try {
        if (proc.pid) process.kill(-proc.pid, sig);
      } catch {
        try { proc.kill(sig); } catch { /* already dead */ }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killed = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 2000);
    }, timeoutMs);

    const abortHandler = () => {
      if (!killed) {
        killed = true;
        killTree("SIGTERM");
      }
    };
    opts.signal?.addEventListener("abort", abortHandler, { once: true });

    proc.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abortHandler);

      const stdout = truncateOutput(Buffer.concat(stdoutChunks).toString("utf8"), maxBytes);
      const stderr = truncateOutput(Buffer.concat(stderrChunks).toString("utf8"), maxBytes);

      resolve({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - start,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abortHandler);

      resolve({
        exitCode: null,
        stdout: "",
        stderr: err.message,
        timedOut: false,
        durationMs: Date.now() - start,
      });
    });
  });
}
