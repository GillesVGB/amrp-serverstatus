import { spawn } from "node:child_process";
import { createServer } from "node:http";

const port = Number(process.env.PORT) || 10000;
let workerStarted = false;
let shuttingDown = false;

const worker = spawn(process.execPath, ["monitor/worker.mjs"], {
  env: process.env,
  stdio: "inherit",
});

const server = createServer((request, response) => {
  if ((request.method === "GET" || request.method === "HEAD") && (request.url === "/" || request.url === "/health")) {
    const workerAlive = workerStarted && worker.exitCode === null && worker.signalCode === null;
    const body = JSON.stringify({ status: workerAlive ? "ok" : "unavailable", monitor: workerAlive ? "running" : "stopped" });
    response.writeHead(workerAlive ? 200 : 503, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  response.writeHead(404, { "Cache-Control": "no-store" });
  response.end("Not found");
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Monitor health endpoint listening on 0.0.0.0:${port}.`);
});

worker.once("spawn", () => {
  workerStarted = true;
});

worker.once("error", (error) => {
  console.error("Could not start monitor worker:", error);
  server.close(() => process.exit(1));
});

worker.once("exit", (code, signal) => {
  if (shuttingDown) return;
  console.error(`Monitor worker exited unexpectedly (code ${code ?? "none"}, signal ${signal ?? "none"}).`);
  server.close(() => process.exit(code && code !== 0 ? code : 1));
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Stopping monitor service (${signal}).`);
  server.close();
  if (workerStarted && worker.exitCode === null && worker.signalCode === null) {
    worker.kill(signal);
  }
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
