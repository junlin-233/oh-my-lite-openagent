import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const installPathsModule = await import(pathToFileURL(path.resolve(process.cwd(), "scripts/install-paths.mjs")).href);
const defaultConfigDir = installPathsModule.defaultConfigDir as () => string;

it("re-exports the shared default config directory helper from the installer", () => {
  const installScript = readFileSync(path.resolve(process.cwd(), "scripts/install.mjs"), "utf8");

  expect(installScript).toContain('import { defaultConfigDir } from "./install-paths.mjs";');
  expect(installScript).toContain("export { defaultConfigDir };");
});

describe("installer default config directory", () => {
  const originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR;
  const originalAppData = process.env.APPDATA;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir;
    process.env.APPDATA = originalAppData;
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  });

  it("uses APPDATA on Windows", () => {
    delete process.env.OPENCODE_CONFIG_DIR;
    process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming";
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    expect(defaultConfigDir()).toBe(path.join("C:\\Users\\Test\\AppData\\Roaming", "opencode"));
  });

  it("lets OPENCODE_CONFIG_DIR override platform defaults", () => {
    process.env.OPENCODE_CONFIG_DIR = path.join(os.tmpdir(), "custom-opencode");
    process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming";
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    expect(defaultConfigDir()).toBe(path.resolve(process.env.OPENCODE_CONFIG_DIR));
  });
});
