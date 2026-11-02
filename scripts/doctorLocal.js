import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateEnvironment } from "../utils/loadEnv.js";
import {
  MINIMUM_NODE_MAJOR,
  MINIMUM_NPM_MAJOR,
  findEnvironmentIssues,
  formatEnvironmentIssues,
  npmVersionFromUserAgent,
  parseEnvironment,
  parseMajorVersion,
} from "./localDevelopmentConfig.js";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timeoutMs = 1500;
let failed = false;

function report(kind, message) {
  const labels = { ok: "OK", warning: "WARN", failure: "FAIL" };
  console.log(`[${labels[kind]}] ${message}`);
  if (kind === "failure") failed = true;
}

function commandResult(command, args) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  return spawnSync(executable, args, { encoding: "utf8", stdio: "pipe" });
}

export function canRunCommand(command, args = ["--version"]) {
  const result = commandResult(command, args);
  return !result.error && result.status === 0;
}

export function probeTcp(host, port, duration = timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(duration, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function checkTcpService(label, urlValue, defaultPort) {
  try {
    const url = new URL(urlValue);
    const port = Number(url.port || defaultPort);
    const reachable = await probeTcp(url.hostname, port);
    report(
      reachable ? "ok" : "failure",
      reachable
        ? `${label} is reachable at ${url.hostname}:${port}`
        : `${label} is unavailable at ${url.hostname}:${port}`,
    );
  } catch {
    report("failure", `${label} URL is invalid`);
  }
}

async function checkStorage(environment) {
  if (environment.STORAGE_PROVIDER !== "s3-compatible") {
    report(
      "failure",
      "Native storage requires STORAGE_PROVIDER=s3-compatible; AWS is not required",
    );
    return;
  }
  try {
    const endpoint = new URL(environment.STORAGE_ENDPOINT);
    const port = Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80));
    const reachable = await probeTcp(endpoint.hostname, port);
    report(
      reachable ? "ok" : "failure",
      reachable
        ? `Object storage is reachable at ${endpoint.hostname}:${port}`
        : `Object storage is unavailable at ${endpoint.hostname}:${port}`,
    );
  } catch {
    report("failure", "Object storage endpoint is invalid");
  }
}

async function checkApiPort(environment) {
  const host = ["0.0.0.0", "::"].includes(environment.HOST)
    ? "127.0.0.1"
    : environment.HOST;
  const port = Number(environment.PORT);
  if (!host || !Number.isInteger(port)) return;

  const occupied = await probeTcp(host, port, 500);
  report(
    occupied ? "failure" : "ok",
    occupied
      ? `API port ${host}:${port} is already occupied; stop the Docker API or change PORT`
      : `API port ${host}:${port} is available`,
  );
}

async function main() {
  console.log("TrackFusionWeb local development doctor\n");

  const nodeMajor = parseMajorVersion(process.versions.node);
  report(
    nodeMajor >= MINIMUM_NODE_MAJOR ? "ok" : "failure",
    nodeMajor >= MINIMUM_NODE_MAJOR
      ? `Node.js ${process.versions.node} is supported`
      : `Node.js ${MINIMUM_NODE_MAJOR} or newer is required`,
  );

  let npmVersion = npmVersionFromUserAgent(process.env.npm_config_user_agent);
  let npmResult = { status: npmVersion ? 0 : null };
  if (!npmVersion) {
    npmResult = commandResult("npm", ["--version"]);
    npmVersion = npmResult.stdout?.trim();
  }
  const npmMajor = parseMajorVersion(npmVersion);
  report(
    npmResult.status === 0 && npmMajor >= MINIMUM_NPM_MAJOR ? "ok" : "failure",
    npmResult.status === 0 && npmMajor >= MINIMUM_NPM_MAJOR
      ? `npm ${npmVersion} is supported`
      : `npm ${MINIMUM_NPM_MAJOR} or newer is required`,
  );

  try {
    await access(path.join(rootDirectory, "node_modules"));
    report("ok", "Node dependencies are installed");
  } catch {
    report("failure", "Node dependencies are missing; run npm run setup");
  }

  let environment;
  try {
    const [environmentText, exampleText] = await Promise.all([
      readFile(path.join(rootDirectory, ".env"), "utf8"),
      readFile(path.join(rootDirectory, ".env.example"), "utf8"),
    ]);
    environment = parseEnvironment(environmentText);
    const issues = formatEnvironmentIssues(
      findEnvironmentIssues(exampleText, environmentText),
    );
    if (issues.length > 0) {
      report("failure", `Local .env needs attention: ${issues.join("; ")}`);
    } else {
      report("ok", ".env contains the expected local settings");
    }
  } catch (error) {
    report(
      "failure",
      error.code === "ENOENT"
        ? ".env is missing; run npm run setup"
        : `Unable to read local configuration: ${error.message}`,
    );
  }

  if (environment) {
    for (const [name, value] of Object.entries(environment)) {
      if (process.env[name] === undefined) process.env[name] = value;
    }
    environment = Object.fromEntries(
      Object.keys(environment).map((name) => [name, process.env[name]]),
    );
    try {
      validateEnvironment();
      report("ok", "Application environment validation passed");
    } catch (error) {
      report("failure", `Application environment is invalid: ${error.message}`);
    }

    await checkTcpService("PostgreSQL", environment.DATABASE_URL, 5432);
    await checkTcpService("Redis", environment.REDIS_URL, 6379);
    await checkStorage(environment);
    if (
      environment.EMAIL_PROVIDER === "smtp" &&
      environment.EMAIL_DELIVERY_ENABLED === "true"
    ) {
      await checkTcpService(
        "SMTP",
        `smtp://${environment.SMTP_HOST}:${environment.SMTP_PORT}`,
        25,
      );
    }
    await checkApiPort(environment);
  }

  const pythonCommand = environment?.PYTHON_EXECUTABLE || "python3";
  const pythonAvailable = canRunCommand(pythonCommand);
  report(
    pythonAvailable ? "ok" : "warning",
    pythonAvailable
      ? `Python is available through ${pythonCommand}`
      : `Python is unavailable through ${pythonCommand}; audio analysis will not work`,
  );
  const ffmpegAvailable = canRunCommand("ffmpeg", ["-version"]);
  report(
    ffmpegAvailable ? "ok" : "warning",
    ffmpegAvailable
      ? "FFmpeg is available"
      : "FFmpeg is unavailable; audio processing will not work",
  );

  console.log("");
  if (failed) {
    console.error("Doctor found blocking native-development issues.");
    process.exitCode = 1;
  } else {
    console.log("Native development prerequisites look ready.");
  }
}

main().catch((error) => {
  console.error(`Doctor failed: ${error.message}`);
  process.exitCode = 1;
});
