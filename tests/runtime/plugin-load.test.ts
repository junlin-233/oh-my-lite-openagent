import { createBoundedLitePlugin } from "../../.opencode/plugins/bounded-lite.js";

describe("plugin safety", () => {
  it("loads without touching the client during initialization", async () => {
    const client = new Proxy(
      {},
      {
        get() {
          throw new Error("client should not be touched during init");
        },
      },
    );

    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
        client,
      }),
    );

    expect(hooks).toBeTruthy();
  });

  it("registers only provider-safe namespaced custom tools", async () => {
    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
      }),
    );

    const toolNames = Object.keys(hooks.tool ?? {});
    expect(toolNames).not.toHaveLength(0);
    expect(toolNames).toContain("bounded_lite_plan_dag");
    expect(toolNames).toContain("bounded_lite_plan_readiness");
    expect(toolNames.every((toolName) => toolName.startsWith("bounded_lite_"))).toBe(true);
    expect(toolNames.every((toolName) => /^[a-zA-Z0-9_-]+$/.test(toolName))).toBe(true);
  });

  it("keeps model config writes behind an explicit permission ask", async () => {
    const hooks = await Promise.resolve(
      createBoundedLitePlugin({
        directory: process.cwd(),
      }),
    );
    const output: { status: "allow" | "ask" | "deny" } = { status: "deny" };

    await hooks["permission.ask"]?.(
      { tool: "bounded_lite_model_config", action: "execute" },
      output,
    );

    expect(output.status).toBe("ask");
  });
});
