import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");
const viteBin = path.join(workspaceRoot, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");

const children = [
  start("sync", process.execPath, [path.join(workspaceRoot, "scripts", "sync-server.mjs")]),
  start("app", viteBin, ["--host", "0.0.0.0"])
];

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => write(name, chunk));
  child.stderr.on("data", (chunk) => write(name, chunk));
  child.on("exit", (code) => {
    if (code === 0 || process.exitCode !== undefined) return;
    console.error(`[${name}] exited with code ${code}`);
    stopAll();
  });

  return child;
}

function write(name, chunk) {
  const lines = chunk.toString().split(/\r?\n/);
  lines.forEach((line) => {
    if (line) console.log(`[${name}] ${line}`);
  });
}

function stopAll() {
  process.exitCode = 0;
  children.forEach((child) => {
    if (!child.killed) child.kill("SIGTERM");
  });
}
