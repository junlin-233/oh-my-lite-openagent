#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN_FILE = "bounded-lite.ts";
const MANAGED_DIRS = ["agents", "plugins", "lib"];
const DEFAULT_PLUGIN_OPTIONS = { mode: "full" };

function parseArgs(argv) {
  const args = {
    configDir: process.env.OPENCODE_CONFIG_DIR,
    dryRun: false,
    rootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--config-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--config-dir requires a path");
      args.configDir = value;
      index += 1;
      continue;
    }

    if (arg === "--root-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root-dir requires a path");
      args.rootDir = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function defaultConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return path.resolve(process.env.OPENCODE_CONFIG_DIR);
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "opencode");
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Failed to read JSON ${filePath}: ${error.message}`);
  }
}

async function copyDir(sourceDir, targetDir, dryRun) {
  if (dryRun) return;

  await mkdir(targetDir, { recursive: true });

  for (const entry of await readdir(sourceDir)) {
    const sourcePath = path.join(sourceDir, entry);
    const targetPath = path.join(targetDir, entry);
    const info = await stat(sourcePath);

    if (info.isDirectory()) {
      await copyDir(sourcePath, targetPath, dryRun);
      continue;
    }

    if (info.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

function isManagedPluginSpec(spec) {
  const value = Array.isArray(spec) ? spec[0] : spec;
  return typeof value === "string" && value.includes(PLUGIN_FILE);
}

function relativePluginSpec() {
  return ["./.opencode/plugins/bounded-lite.ts", DEFAULT_PLUGIN_OPTIONS];
}

function mergeConfig(existingConfig, sourceConfig) {
  const existingPlugins = Array.isArray(existingConfig.plugin)
    ? existingConfig.plugin
    : existingConfig.plugin
      ? [existingConfig.plugin]
      : [];

  const plugins = [
    ...existingPlugins.filter((spec) => !isManagedPluginSpec(spec)),
    relativePluginSpec(),
  ];

  return {
    ...existingConfig,
    $schema: existingConfig.$schema ?? sourceConfig.$schema,
    plugin: plugins,
    default_agent: sourceConfig.default_agent,
    permission: existingConfig.permission ?? sourceConfig.permission,
    agent: {
      ...(existingConfig.agent ?? {}),
      ...sourceConfig.agent,
    },
  };
}

async function writeJson(filePath, value, dryRun) {
  if (dryRun) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(`${filePath}.bak`, `${JSON.stringify(await readJsonIfExists(filePath), null, 2)}\n`);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function install(options = {}) {
  const rootDir = path.resolve(
    options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const configDir = path.resolve(options.configDir ?? defaultConfigDir());
  const dryRun = Boolean(options.dryRun);
  const sourceConfig = await readJsonIfExists(path.join(rootDir, "opencode.json"));
  const targetConfigPath = path.join(configDir, "opencode.json");
  const existingConfig = await readJsonIfExists(targetConfigPath);
  const mergedConfig = mergeConfig(existingConfig, sourceConfig);
  const sourceOpenCodeDir = path.join(rootDir, ".opencode");
  const targetOpenCodeDir = path.join(configDir, ".opencode");

  for (const managedDir of MANAGED_DIRS) {
    await copyDir(
      path.join(sourceOpenCodeDir, managedDir),
      path.join(targetOpenCodeDir, managedDir),
      dryRun,
    );
  }

  await writeJson(targetConfigPath, mergedConfig, dryRun);

  return {
    configDir,
    configPath: targetConfigPath,
    plugin: pathToFileURL(path.join(targetOpenCodeDir, "plugins", PLUGIN_FILE)).href,
    dryRun,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await install(args);

  console.log(`OpenCode config: ${result.configPath}`);
  console.log(`Bounded lite plugin: ${result.plugin}`);
  console.log(result.dryRun ? "Dry run complete; no files were written." : "Install complete.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
