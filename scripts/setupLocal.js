import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MINIMUM_NODE_MAJOR,
  MINIMUM_NPM_MAJOR,
  formatEnvironmentIssues,
  npmVersionFromUserAgent,
  parseMajorVersion,
  prepareEnvironment,
} from "./localDevelopmentConfig.js";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

async function main() {
  const nodeMajor = parseMajorVersion(process.versions.node);
  if (!nodeMajor || nodeMajor < MINIMUM_NODE_MAJOR) {
    throw new Error(`Node.js ${MINIMUM_NODE_MAJOR} or newer is required`);
  }

  let npmVersion = npmVersionFromUserAgent(process.env.npm_config_user_agent);
  if (!npmVersion) {
    const npmVersionResult = run(npmCommand(), ["--version"]);
    if (npmVersionResult.status === 0) npmVersion = npmVersionResult.stdout.trim();
  }
  const npmMajor = parseMajorVersion(npmVersion);
  if (!npmMajor || npmMajor < MINIMUM_NPM_MAJOR) {
    throw new Error(`npm ${MINIMUM_NPM_MAJOR} or newer is required`);
  }

  console.log(`Node.js ${process.versions.node} and npm ${npmVersion} detected.`);
  console.log("Installing Node dependencies from package-lock.json...");
  const install = run(npmCommand(), ["ci", "--no-audit", "--no-fund"], {
    stdio: "inherit",
    encoding: undefined,
  });
  if (install.status !== 0) {
    throw new Error("npm ci did not complete successfully");
  }

  const environment = await prepareEnvironment(rootDirectory);
  if (environment.created) {
    console.log("Created .env with generated local-only secrets (values were not printed).");
  } else {
    console.log("Existing .env preserved without changes.");
  }

  const issues = formatEnvironmentIssues(environment);
  if (issues.length > 0) {
    console.error(`Local configuration needs attention: ${issues.join("; ")}.`);
    console.error("Compare those settings with .env.example, then run npm run doctor.");
    process.exitCode = 1;
    return;
  }

  console.log("Setup complete. System services were not installed.");
  console.log("Native mode: npm run doctor, then npm run dev");
  console.log("Docker mode: npm run dev:docker");
}

main().catch((error) => {
  console.error(`Setup failed: ${error.message}`);
  process.exitCode = 1;
});
