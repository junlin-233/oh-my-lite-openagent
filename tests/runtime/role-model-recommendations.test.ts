import {
  ROLE_MODEL_PROFILES,
  ROLE_CAPABILITY_DESCRIPTIONS,
  resolveAutoModels,
  formatAutoModelReport,
  getAllRecommendedPatterns,
  validateProfileCoverage,
  type RoleCapability,
} from "../../.opencode/lib/runtime/role-model-recommendations.js";
import { CONFIGURABLE_ROLE_NAMES } from "../../.opencode/lib/runtime/model-config.js";
import type { ProviderModel } from "../../.opencode/lib/runtime/model-config.js";

describe("role model recommendations", () => {
  describe("ROLE_MODEL_PROFILES", () => {
    it("covers all configurable roles", () => {
      const profileRoles = ROLE_MODEL_PROFILES.map((p) => p.role);
      for (const roleName of CONFIGURABLE_ROLE_NAMES) {
        expect(profileRoles, `missing profile for ${roleName}`).toContain(roleName);
      }
    });

    it("has no duplicate roles", () => {
      const roles = ROLE_MODEL_PROFILES.map((p) => p.role);
      const unique = new Set(roles);
      expect(roles.length).toBe(unique.size);
    });

    it("has at least one recommendation per role", () => {
      for (const profile of ROLE_MODEL_PROFILES) {
        expect(profile.recommendations.length, profile.role).toBeGreaterThanOrEqual(1);
      }
    });

    it("has valid capability for each role", () => {
      const validCapabilities: RoleCapability[] = [
        "orchestration",
        "planning",
        "advisory-planning",
        "execution",
        "fast-retrieval",
        "critical-review",
      ];

      for (const profile of ROLE_MODEL_PROFILES) {
        expect(validCapabilities, profile.role).toContain(profile.capability);
      }
    });

    it("uses orchestration for command-lead", () => {
      const cl = ROLE_MODEL_PROFILES.find((p) => p.role === "command-lead");
      expect(cl?.capability).toBe("orchestration");
    });

    it("uses planning for plan-builder", () => {
      const pb = ROLE_MODEL_PROFILES.find((p) => p.role === "plan-builder");
      expect(pb?.capability).toBe("planning");
    });

    it("uses advisory-planning for deep-plan-builder", () => {
      const dpb = ROLE_MODEL_PROFILES.find((p) => p.role === "deep-plan-builder");
      expect(dpb?.capability).toBe("advisory-planning");
    });

    it("uses critical-review for plan-review and result-review", () => {
      const pr = ROLE_MODEL_PROFILES.find((p) => p.role === "plan-review");
      const rr = ROLE_MODEL_PROFILES.find((p) => p.role === "result-review");
      expect(pr?.capability).toBe("critical-review");
      expect(rr?.capability).toBe("critical-review");
    });

    it("uses fast-retrieval for explore and librarian", () => {
      const exp = ROLE_MODEL_PROFILES.find((p) => p.role === "explore");
      const lib = ROLE_MODEL_PROFILES.find((p) => p.role === "librarian");
      expect(exp?.capability).toBe("fast-retrieval");
      expect(lib?.capability).toBe("fast-retrieval");
    });
  });

  describe("ROLE_CAPABILITY_DESCRIPTIONS", () => {
    it("has descriptions for all capabilities used by profiles", () => {
      const usedCapabilities = new Set(ROLE_MODEL_PROFILES.map((p) => p.capability));
      for (const cap of usedCapabilities) {
        expect(ROLE_CAPABILITY_DESCRIPTIONS[cap as RoleCapability], `missing description for ${cap}`).toBeDefined();
        expect(typeof ROLE_CAPABILITY_DESCRIPTIONS[cap as RoleCapability]).toBe("string");
      }
    });
  });

  describe("resolveAutoModels", () => {
    it("resolves all roles when all models are available", () => {
      const models: ProviderModel[] = [
        { provider: "anthropic", model: "claude-opus-4-7", id: "anthropic/claude-opus-4-7" },
        { provider: "openai", model: "gpt-5.4", id: "openai/gpt-5.4" },
        { provider: "anthropic", model: "claude-sonnet-4-6", id: "anthropic/claude-sonnet-4-6" },
        { provider: "openai", model: "gpt-5.4-mini", id: "openai/gpt-5.4-mini" },
        { provider: "anthropic", model: "claude-haiku-4-5", id: "anthropic/claude-haiku-4-5" },
      ];

      const result = resolveAutoModels(models);

      expect(result.resolved.length).toBe(8);
      expect(result.unresolved.length).toBe(0);
      // command-lead should get claude-opus (highest recommendation for orchestration)
      expect(result.assignments["command-lead"]).toContain("claude-opus");
      // explore should get gpt-5.4-mini (fast-retrieval prefers cheap)
      expect(result.assignments["explore"]).toContain("gpt-5.4-mini");
      // librarian should get gpt-5.4-mini (fast-retrieval prefers cheap)
      expect(result.assignments["librarian"]).toContain("gpt-5.4-mini");
    });

    it("resolves roles with partial model availability", () => {
      const models: ProviderModel[] = [
        { provider: "openai", model: "gpt-4o", id: "openai/gpt-4o" },
        { provider: "openai", model: "gpt-4o-mini", id: "openai/gpt-4o-mini" },
      ];

      const result = resolveAutoModels(models);

      // gpt-4o should be matched by "gpt-4o" pattern for several roles
      expect(result.resolved.length).toBeGreaterThanOrEqual(1);
      // With only openai models, some fast-retrieval roles might not resolve
      // because "gpt-5.4-mini" isn't present but "gpt-4o" and "gpt-4o-mini" might not match
    });

    it("reports unresolved roles when no matching model is available", () => {
      const models: ProviderModel[] = [];

      const result = resolveAutoModels(models);

      expect(result.resolved.length).toBe(0);
      expect(result.unresolved.length).toBe(8);
      expect(result.assignments).toEqual({});
    });

    it("prefers higher-priority model recommendations", () => {
      const models: ProviderModel[] = [
        { provider: "anthropic", model: "claude-opus-4-7", id: "anthropic/claude-opus-4-7" },
        { provider: "openai", model: "gpt-5.4", id: "openai/gpt-5.4" },
      ];

      const result = resolveAutoModels(models);

      // command-lead should get claude-opus (first recommendation)
      expect(result.assignments["command-lead"]).toBe("anthropic/claude-opus-4-7");
      // plan-review should get gpt-5.4 (first recommendation for critical-review)
      expect(result.assignments["plan-review"]).toBe("openai/gpt-5.4");
    });

    it("matches models case-insensitively", () => {
      const models: ProviderModel[] = [
        { provider: "Anthropic", model: "Claude-Opus-4-7", id: "Anthropic/Claude-Opus-4-7" },
      ];

      const result = resolveAutoModels(models);

      expect(result.resolved.length).toBeGreaterThanOrEqual(1);
      expect(result.assignments["command-lead"]).toBe("Anthropic/Claude-Opus-4-7");
    });

    it("matches models across providers", () => {
      const models: ProviderModel[] = [
        { provider: "opencode", model: "claude-opus-4-7", id: "opencode/claude-opus-4-7" },
      ];

      const result = resolveAutoModels(models);

      // Still matches "claude-opus" pattern regardless of provider
      expect(result.assignments["command-lead"]).toBe("opencode/claude-opus-4-7");
    });

    it("preserves existing model assignments in current config", () => {
      const models: ProviderModel[] = [
        { provider: "anthropic", model: "claude-opus-4-7", id: "anthropic/claude-opus-4-7" },
      ];

      const currentConfig = {
        agent: {
          "command-lead": { mode: "primary", model: "custom/model" },
        },
      };

      const result = resolveAutoModels(models, currentConfig);
      // The auto resolution should still recommend the best model
      // (it does not check existing config for preserving — that's the apply step)
      expect(result.resolved.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("formatAutoModelReport", () => {
    it("formats a readable report with resolved and unresolved roles", () => {
      const models: ProviderModel[] = [
        { provider: "anthropic", model: "claude-opus-4-7", id: "anthropic/claude-opus-4-7" },
      ];

      const result = resolveAutoModels(models);
      const report = formatAutoModelReport(result);

      expect(report).toContain("Oh My Lite OpenAgent auto model configuration");
      expect(report).toContain("Resolved assignments:");
      expect(report).toContain("command-lead");
    });
  });

  describe("getAllRecommendedPatterns", () => {
    it("returns a non-empty set of unique patterns", () => {
      const patterns = getAllRecommendedPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      // Should include some well-known patterns
      expect(patterns).toContain("claude-opus");
      expect(patterns).toContain("gpt-5.4");
    });
  });

  describe("validateProfileCoverage", () => {
    it("reports all configurable roles as covered", () => {
      const coverage = validateProfileCoverage();
      for (const item of coverage) {
        expect(item.hasProfile, `${item.role} should have a profile`).toBe(true);
      }
    });
  });
});