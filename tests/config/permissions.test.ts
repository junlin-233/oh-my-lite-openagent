import path from "node:path";
import { pathToFileURL } from "node:url";

const managedConfigModule = await import(
  pathToFileURL(path.resolve(process.cwd(), "scripts/managed-config.mjs")).href
);
const config = managedConfigModule.MANAGED_CONFIG as {
  permission?: Record<string, string | Record<string, string>>;
  agent: Record<
    string,
    { permission?: Record<string, string | Record<string, string>> }
  >;
};

function taskRules(agentName: string): Record<string, string> {
  const task = config.agent[agentName]?.permission?.task;
  return typeof task === "object" && task !== null ? task : {};
}

describe("delegation boundaries", () => {
  it("lets Command Lead delegate across the full registered role skeleton", () => {
    expect(taskRules("command-lead")).toEqual({
      "*": "deny",
      "plan-builder": "allow",
      "deep-plan-builder": "allow",
      "task-lead": "allow",
      explore: "allow",
      librarian: "allow",
      "plan-review": "allow",
      "result-review": "allow",
    });
  });

  it("keeps planners within shared capability delegation only", () => {
    const expected = {
      "*": "deny",
      explore: "allow",
      librarian: "allow",
      "plan-review": "allow",
    };

    expect(taskRules("plan-builder")).toEqual(expected);
    expect(taskRules("deep-plan-builder")).toEqual(expected);
  });

  it("keeps Task Lead bounded and review specialists read-only", () => {
    expect(taskRules("task-lead")).toEqual({
      "*": "deny",
      explore: "allow",
      librarian: "allow",
    });

    expect(taskRules("explore")).toEqual({ "*": "deny" });
    expect(taskRules("librarian")).toEqual({ "*": "deny" });
    expect(taskRules("plan-review")).toEqual({ "*": "deny", explore: "allow" });
    expect(taskRules("result-review")).toEqual({ "*": "deny", explore: "allow" });
  });

  it("denies delegation through disabled OpenCode built-in modes", () => {
    expect(taskRules("build")).toEqual({ "*": "deny" });
    expect(taskRules("plan")).toEqual({ "*": "deny" });
    expect(config.agent.build?.permission?.["*"]).toBe("deny");
    expect(config.agent.plan?.permission?.["*"]).toBe("deny");
  });

  it("puts task deny catch-alls before specific allows because OpenCode uses last match wins", () => {
    for (const [agentName, rules] of Object.entries(config.agent)) {
      const task = rules.permission?.task;
      if (typeof task !== "object" || task === null) continue;

      expect(Object.keys(task)[0], agentName).toBe("*");
    }
  });

  it("uses scalar web permissions accepted by OpenCode config validation", () => {
    expect(config.agent.explore?.permission?.webfetch).toBe("deny");
    expect(config.agent.explore?.permission?.websearch).toBe("deny");
    expect(config.agent.librarian?.permission?.webfetch).toBe("allow");
    expect(config.agent.librarian?.permission?.websearch).toBe("allow");
  });

  it("allows ordinary bash commands while asking for dangerous or sensitive commands", () => {
    const bash = config.permission?.bash;
    expect(typeof bash).toBe("object");
    if (typeof bash !== "object" || bash === null) return;

    expect(Object.keys(bash)[0]).toBe("*");
    expect(bash["*"]).toBe("allow");
    expect(bash["rm"]).toBe("ask");
    expect(bash["rm *"]).toBe("ask");
    expect(bash["git push"]).toBe("ask");
    expect(bash["git push *"]).toBe("ask");
    expect(bash["node scripts/install.mjs --dry-run"]).toBe("allow");
    expect(bash["node scripts/install.mjs --dry-run *"]).toBe("allow");
    expect(bash["node scripts/install.mjs"]).toBe("ask");
    expect(bash["node scripts/install.mjs *"]).toBe("ask");
  });

  it("asks for dangerous pipe operations in bash with correct rule ordering", () => {
    const bash = config.permission?.bash;
    expect(typeof bash).toBe("object");
    if (typeof bash !== "object" || bash === null) return;

    expect(bash["curl * | *"]).toBe("ask");
    expect(bash["wget * | *"]).toBe("ask");
    expect(bash["bash <(curl *)"]).toBe("ask");
    expect(bash["bash <(wget *)"]).toBe("ask");
    expect(bash["eval \"$(curl *)\""]).toBe("ask");
    expect(bash["eval \"$(wget *)\""]).toBe("ask");

    // Verify ask rules come AFTER the default allow (last match wins)
    const bashKeys = Object.keys(bash);
    const allowIndex = bashKeys.indexOf("*");
    const curlDenyIndex = bashKeys.indexOf("curl * | *");
    const wgetDenyIndex = bashKeys.indexOf("wget * | *");

    expect(curlDenyIndex).toBeGreaterThan(allowIndex);
    expect(wgetDenyIndex).toBeGreaterThan(allowIndex);
  });

  it("asks for dangerous git and npm operations", () => {
    const bash = config.permission?.bash;
    expect(typeof bash).toBe("object");
    if (typeof bash !== "object" || bash === null) return;

    expect(bash["git push"]).toBe("ask");
    expect(bash["git push *"]).toBe("ask");
    expect(bash["git commit"]).toBe("ask");
    expect(bash["git commit *"]).toBe("ask");
    expect(bash["git reset"]).toBe("ask");
    expect(bash["git reset *"]).toBe("ask");
    expect(bash["npm uninstall"]).toBe("ask");
    expect(bash["npm uninstall *"]).toBe("ask");
    expect(bash["npm publish"]).toBe("ask");
    expect(bash["npm publish *"]).toBe("ask");
  });

  it("asks for system privilege operations", () => {
    const bash = config.permission?.bash;
    expect(typeof bash).toBe("object");
    if (typeof bash !== "object" || bash === null) return;

    expect(bash["sudo"]).toBe("ask");
    expect(bash["sudo *"]).toBe("ask");
    expect(bash["chmod"]).toBe("ask");
    expect(bash["chmod *"]).toBe("ask");
    expect(bash["chown"]).toBe("ask");
    expect(bash["chown *"]).toBe("ask");
  });

  it("allows normal file edits but protects sensitive files", () => {
    const edit = config.permission?.edit;
    expect(typeof edit).toBe("object");
    if (typeof edit !== "object" || edit === null) return;

    // Verify * is first (last match wins)
    expect(Object.keys(edit)[0]).toBe("*");
    expect(edit["*"]).toBe("allow");
    expect(edit["*.env"]).toBe("ask");
    expect(edit["**/*.key"]).toBe("ask");
    expect(edit["**/*.pem"]).toBe("ask");
    expect(edit["**/opencode.json"]).toBe("ask");
    expect(edit["**/opencode.jsonc"]).toBe("ask");
    expect(edit["**/package.json"]).toBe("ask");
  });

  it("denies lock file modifications", () => {
    const edit = config.permission?.edit;
    expect(typeof edit).toBe("object");
    if (typeof edit !== "object" || edit === null) return;

    expect(edit["**/package-lock.json"]).toBe("deny");
    expect(edit["**/yarn.lock"]).toBe("deny");
    expect(edit["**/pnpm-lock.yaml"]).toBe("deny");
    expect(edit["**/Cargo.lock"]).toBe("deny");
    expect(edit["**/poetry.lock"]).toBe("deny");
    expect(edit["**/composer.lock"]).toBe("deny");
  });

  it("uses the permissive bash policy for every real role", () => {
    const globalBash = config.permission?.bash;
    expect(typeof globalBash).toBe("object");
    if (typeof globalBash !== "object" || globalBash === null) return;

    for (const agentName of [
      "command-lead",
      "plan-builder",
      "deep-plan-builder",
      "task-lead",
      "explore",
      "librarian",
      "plan-review",
      "result-review",
    ]) {
      const agentBash = config.agent[agentName]?.permission?.bash ?? globalBash;
      expect(typeof agentBash).toBe("object");
      if (typeof agentBash !== "object" || agentBash === null) continue;

      expect(Object.keys(agentBash)[0], agentName).toBe("*");
      expect(agentBash["*"], agentName).toBe("allow");
      expect(agentBash["rm *"], agentName).toBe("ask");
      expect(agentBash["git push"], agentName).toBe("ask");
      expect(agentBash["node scripts/install.mjs"], agentName).toBe("ask");
      expect(agentBash["curl * | *"], agentName).toBe("ask");
      expect(agentBash["node scripts/install.mjs --dry-run"], agentName).toBe("allow");
      expect(Object.values(agentBash), agentName).not.toContain("deny");
    }
  });

  it("keeps disabled built-in modes fully denied", () => {
    expect(config.agent.build?.permission?.bash).toEqual({ "*": "deny" });
    expect(config.agent.plan?.permission?.bash).toEqual({ "*": "deny" });
  });

  it("keeps Task Lead edit-capable for bounded execution", () => {
    const taskLeadPermission = config.agent["task-lead"]?.permission;
    const edit = taskLeadPermission?.edit;

    expect(edit).toEqual({ "*": "allow" });
  });
});
