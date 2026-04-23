import { createRuntimeProfile } from "../../.opencode/lib/runtime/safety.js";

describe("degraded mode", () => {
  it("preserves the visible architecture when optional runtime enhancements are off", () => {
    const profile = createRuntimeProfile({
      pluginEnabled: false,
      hooksEnabled: false,
      backgroundEnabled: false,
      bundledMcpEnabled: false,
    });

    expect(profile.mode).toBe("degraded");
    expect(profile.visibleModes).toEqual(["execution", "planning", "deep-planning"]);
    expect(profile.roleNames).toHaveLength(8);
    expect(profile.canonicalStates).toEqual([
      "draft",
      "needs-approval",
      "approved",
      "executing",
      "reviewed",
    ]);
  });
});
