import { readFileSync } from "node:fs";
import path from "node:path";

const configPath = path.resolve(process.cwd(), "opencode.json");
const config = JSON.parse(readFileSync(configPath, "utf8")) as {
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

  it("allows common safe validation commands while asking for other bash commands", () => {
    const bash = config.permission?.bash;
    expect(typeof bash).toBe("object");
    if (typeof bash !== "object" || bash === null) return;

    expect(Object.keys(bash)[0]).toBe("*");
    expect(bash["*"]).toBe("ask");
    expect(bash["git status"]).toBe("allow");
    expect(bash["git status *"]).toBe("allow");
    expect(bash["git diff"]).toBe("allow");
    expect(bash["git diff *"]).toBe("allow");
    expect(bash["npm test"]).toBe("allow");
    expect(bash["npm test *"]).toBe("allow");
    expect(bash["npm run typecheck"]).toBe("allow");
    expect(bash["npm run typecheck *"]).toBe("allow");
    expect(bash["node scripts/install.mjs --dry-run"]).toBe("allow");
    expect(bash["node scripts/install.mjs --dry-run *"]).toBe("allow");
  });

  it("denies dangerous pipe operations in bash with correct rule ordering", () => {
    const bash = config.permission?.bash;
    expect(typeof bash).toBe("object");
    if (typeof bash !== "object" || bash === null) return;

    // Verify deny rules exist
    expect(bash["curl * | *"]).toBe("deny");
    expect(bash["wget * | *"]).toBe("deny");
    expect(bash["bash <(curl *)"]).toBe("deny");
    expect(bash["bash <(wget *)"]).toBe("deny");
    expect(bash["eval \"$(curl *)\""]).toBe("deny");
    expect(bash["eval \"$(wget *)\""]).toBe("deny");

    // Verify deny rules come AFTER allow rules (last match wins)
    const bashKeys = Object.keys(bash);
    const curlAllowIndex = bashKeys.indexOf("curl *");
    const curlDenyIndex = bashKeys.indexOf("curl * | *");
    const wgetAllowIndex = bashKeys.indexOf("wget *");
    const wgetDenyIndex = bashKeys.indexOf("wget * | *");

    expect(curlDenyIndex).toBeGreaterThan(curlAllowIndex);
    expect(wgetDenyIndex).toBeGreaterThan(wgetAllowIndex);
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

  it("keeps Task Lead non-interactive by allowing edits and denying non-whitelisted bash", () => {
    const taskLeadPermission = config.agent["task-lead"]?.permission;
    const edit = taskLeadPermission?.edit;
    const bash = taskLeadPermission?.bash;

    expect(edit).toEqual({ "*": "allow" });
    expect(typeof bash).toBe("object");
    if (typeof bash !== "object" || bash === null) return;

    expect(Object.keys(bash)[0]).toBe("*");
    expect(bash["*"]).toBe("deny");
    expect(bash["npm test"]).toBe("allow");
    expect(bash["npm run typecheck"]).toBe("allow");
    expect(Object.values(bash)).not.toContain("ask");
  });
});
