const PERMISSIVE_BASH_PERMISSION = {
  "*": "allow",
  "rm": "ask",
  "rm *": "ask",
  "rmdir": "ask",
  "rmdir *": "ask",
  "mv": "ask",
  "mv *": "ask",
  "move": "ask",
  "move *": "ask",
  "cp -rf *": "ask",
  "xcopy * /y": "ask",
  "> *": "ask",
  "git push": "ask",
  "git push *": "ask",
  "git commit": "ask",
  "git commit *": "ask",
  "git reset": "ask",
  "git reset *": "ask",
  "git clean": "ask",
  "git clean *": "ask",
  "git merge": "ask",
  "git merge *": "ask",
  "git rebase": "ask",
  "git rebase *": "ask",
  "git cherry-pick": "ask",
  "git cherry-pick *": "ask",
  "git stash drop": "ask",
  "git stash drop *": "ask",
  "git branch -D": "ask",
  "git branch -D *": "ask",
  "npm uninstall": "ask",
  "npm uninstall *": "ask",
  "npm remove": "ask",
  "npm remove *": "ask",
  "npm publish": "ask",
  "npm publish *": "ask",
  "npm version": "ask",
  "npm version *": "ask",
  "npm unpublish": "ask",
  "npm unpublish *": "ask",
  "npm run install:opencode": "ask",
  "npm run install:opencode *": "ask",
  "node scripts/install.mjs": "ask",
  "node scripts/install.mjs *": "ask",
  "node scripts/install.mjs --dry-run": "allow",
  "node scripts/install.mjs --dry-run *": "allow",
  "curl * | *": "ask",
  "wget * | *": "ask",
  "bash <(curl *)": "ask",
  "bash <(wget *)": "ask",
  "eval \"$(curl *)\"": "ask",
  "eval \"$(wget *)\"": "ask",
  "sudo": "ask",
  "sudo *": "ask",
  "su": "ask",
  "su *": "ask",
  "chmod": "ask",
  "chmod *": "ask",
  "chown": "ask",
  "chown *": "ask",
  "dd": "ask",
  "dd *": "ask",
  "mkfs": "ask",
  "mkfs *": "ask",
  "mount": "ask",
  "mount *": "ask",
  "umount": "ask",
  "umount *": "ask"
};

export const MANAGED_CONFIG = {
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "command-lead",
  "provider": {
    "aiwanwu": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AIWanwu",
      "options": {
        "baseURL": "https://www.aiwanwu.cc/v1",
        "apiKey": "YOUR_AIWANWU_API_KEY_HERE"
      },
      "models": {
        "gpt-5-codex": {
          "name": "GPT-5 Codex",
          "limit": {
            "context": 400000,
            "output": 128000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {}
          }
        },
        "gpt-5.1-codex": {
          "name": "GPT-5.1 Codex",
          "limit": {
            "context": 400000,
            "output": 128000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {}
          }
        },
        "gpt-5.1-codex-max": {
          "name": "GPT-5.1 Codex Max",
          "limit": {
            "context": 400000,
            "output": 128000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {}
          }
        },
        "gpt-5.1-codex-mini": {
          "name": "GPT-5.1 Codex Mini",
          "limit": {
            "context": 400000,
            "output": 128000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {}
          }
        },
        "gpt-5.2": {
          "name": "GPT-5.2",
          "limit": {
            "context": 400000,
            "output": 128000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {},
            "xhigh": {}
          }
        },
        "gpt-5.4": {
          "name": "GPT-5.4",
          "limit": {
            "context": 1050000,
            "output": 128000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {},
            "xhigh": {}
          }
        },
        "gpt-5.4-mini": {
          "name": "GPT-5.4 Mini",
          "limit": {
            "context": 400000,
            "output": 128000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {},
            "xhigh": {}
          }
        },
        "gpt-5.4-nano": {
          "name": "GPT-5.4 Nano",
          "limit": {
            "context": 400000,
            "output": 128000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {},
            "xhigh": {}
          }
        },
        "gpt-5.3-codex-spark": {
          "name": "GPT-5.3 Codex Spark",
          "limit": {
            "context": 128000,
            "output": 32000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {},
            "xhigh": {}
          }
        },
        "gpt-5.3-codex": {
          "name": "GPT-5.3 Codex",
          "limit": {
            "context": 400000,
            "output": 128000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {},
            "xhigh": {}
          }
        },
        "gpt-5.2-codex": {
          "name": "GPT-5.2 Codex",
          "limit": {
            "context": 400000,
            "output": 128000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {},
            "xhigh": {}
          }
        },
        "codex-mini-latest": {
          "name": "Codex Mini",
          "limit": {
            "context": 200000,
            "output": 100000
          },
          "options": {
            "store": false
          },
          "variants": {
            "low": {},
            "medium": {},
            "high": {}
          }
        }
      }
    }
  },
  "model": "aiwanwu/gpt-5.4",
  "small_model": "aiwanwu/gpt-5.4-mini",
  "plugin": [
    [
      "./.opencode/plugins/bounded-lite.ts",
      {
        "mode": "full",
        "configDir": "C:\\path\\to\\oh-my-lite-openagent",
        "taskLeadProfiles": {
          "visual": {
            "model": "aiwanwu/gpt-5.4"
          },
          "code": {
            "model": "aiwanwu/gpt-5.4"
          },
          "quick": {
            "model": "aiwanwu/gpt-5.4-mini"
          },
          "research": {
            "model": "aiwanwu/gpt-5.4-mini"
          },
          "writing": {
            "model": "aiwanwu/gpt-5.4"
          },
          "deep": {
            "model": "aiwanwu/gpt-5.4"
          },
          "risk-high": {
            "model": "aiwanwu/gpt-5.4"
          }
        }
      }
    ]
  ],
  "command": {
    "agent-models": {
      "description": "Import available OpenCode provider models, preview recommended per-role model/reasoning effort and Task Lead profile assignments, and apply them after user confirmation.",
      "agent": "command-lead",
      "template": "Configure model assignments for Oh My Lite OpenAgent roles and Task Lead profiles.\n\n## Goal\n\nUse AI to recommend role models and Task Lead profile models from all available OpenCode model providers. The AI must not invent provider/model IDs.\n\nTask Lead profiles do not add new agents. They are selected from `plan.subtasks[].attributes` and provide dispatch metadata such as recommended model, fallback chain, and prompt guidance. Do not create new Task Lead agents. Current execution still uses the single hidden `task-lead` agent unless the runtime supports per-task model override.\n\n## Required Workflow\n\n0. Execution owner must be command-lead. Do not delegate /agent-models execution to task or task-lead. If delegation happened, treat it as flow drift and rerun directly from command-lead.\n\n1. Import the available model pool. By default this includes every discovered provider, including OpenCode subscription providers such as opencode and opencode-go. The current global model is context only and must not be used as a hard import filter.\n\n```\nbounded_lite_model_config({ action: \"import\" })\n```\n\n2. Ask the tool to show the usable imported model pool first, then generate recommended assignments. This is a preview only and must not write config.\n\n```\nbounded_lite_model_config({ action: \"auto\" })\n```\n\naction=auto is recommendation-only. It returns the available imported model pool before role recommendations and Task Lead profile recommendations, including `Recommended Task Lead profile assignments JSON`.\n\n3. Show the available model pool, then the recommended role assignments and Task Lead profile assignments to the user, and ask whether they want changes. If the user wants changes, revise only by choosing model IDs returned by action=import/auto.\n\n4. Apply only after the user accepts the recommendations or gives modifications.\n\n```\nbounded_lite_model_config({\n  action: \"apply\",\n  assignments: {\n    \"command-lead\": \"provider/model\",\n    \"explore\": \"provider/model\"\n  },\n  taskLeadProfileAssignments: {\n    \"code\": \"provider/model\",\n    \"quick\": \"provider/model\",\n    \"visual\": \"provider/model\"\n  }\n})\n```\n\n5. If needed, read back effective assignments.\n\n```\nbounded_lite_model_config({ action: \"list\" })\n```\n\n## Hard Constraints\n\n- Always pass an explicit action field: import, auto, apply, or list.\n- Forbidden: `bounded_lite_model_config({})`.\n- Forbidden: any call that omits `action`.\n- Never invent provider/model IDs. Choose only from action=import or action=auto returned model pool.\n\n## Failure Recovery\n\n- If tool returns `MODELCFG_ERR_MISSING_ACTION`, immediately retry with the intended explicit `action`.\n- Do not continue with empty payload calls after this error.\n\n## Evidence Requirement\n\nUse structured tool_use logs as acceptance evidence, not only natural language replies.\n\n## Notes\n\nIf the imported pool is empty, guide the user to connect providers first (for example: finish connect 之后 verify runtime provider models, check auth.json/models.dev state), then rerun import/auto.\n"
    }
  },
  "permission": {
    "edit": {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      ".env*": "ask",
      "**/opencode.json": "ask",
      "**/opencode.jsonc": "ask",
      "**/package.json": "ask",
      "**/package-lock.json": "deny",
      "**/yarn.lock": "deny",
      "**/pnpm-lock.yaml": "deny",
      "**/Cargo.lock": "deny",
      "**/poetry.lock": "deny",
      "**/composer.lock": "deny",
      "**/*.key": "ask",
      "**/*.pem": "ask",
      "**/secrets*": "ask",
      "**/.opencode/**": "ask",
      "**/install.mjs": "ask"
    },
    "bash": { ...PERMISSIVE_BASH_PERMISSION },
    "task": {
      "*": "deny"
    }
  },
  "agent": {
    "command-lead": {
      "mode": "primary",
      "color": "#87cefa",
      "description": "Main orchestrator for execution work with approval and state ownership.",
      "prompt": "{file:./.opencode/agents/command-lead.md}",
      "permission": {
        "task": {
          "*": "deny",
          "plan-builder": "allow",
          "deep-plan-builder": "allow",
          "task-lead": "allow",
          "explore": "allow",
          "librarian": "allow",
          "plan-review": "allow",
          "result-review": "allow"
        },
        "bash": { ...PERMISSIVE_BASH_PERMISSION }
      }
    },
    "plan-builder": {
      "mode": "all",
      "description": "Visible planner with explicit discussion mode for user-facing planning and internal normalize mode for stable skeleton convergence.",
      "prompt": "{file:./.opencode/agents/plan-builder.md}",
      "permission": {
        "task": {
          "*": "deny",
          "explore": "allow",
          "librarian": "allow",
          "plan-review": "allow"
        },
        "edit": {
          "*": "allow"
        },
        "bash": { ...PERMISSIVE_BASH_PERMISSION }
      }
    },
    "deep-plan-builder": {
      "mode": "all",
      "color": "#ff0000",
      "description": "Visible deep planner that produces detailed handoff plans for lower-strength executors with mandatory plan review.",
      "prompt": "{file:./.opencode/agents/deep-plan-builder.md}",
      "permission": {
        "task": {
          "*": "deny",
          "explore": "allow",
          "librarian": "allow",
          "plan-review": "allow"
        },
        "edit": {
          "*": "deny",
          ".liteagent/**": "allow",
          "**/.liteagent/**": "allow"
        },
        "bash": { ...PERMISSIVE_BASH_PERMISSION }
      }
    },
    "build": {
      "mode": "subagent",
      "hidden": true,
      "description": "Disabled built-in OpenCode build mode; use command-lead.",
      "permission": {
        "task": {
          "*": "deny"
        },
        "edit": {
          "*": "deny"
        },
        "bash": {
          "*": "deny"
        },
        "*": "deny"
      }
    },
    "plan": {
      "mode": "subagent",
      "hidden": true,
      "description": "Disabled built-in OpenCode plan mode; use plan-builder or deep-plan-builder.",
      "permission": {
        "task": {
          "*": "deny"
        },
        "edit": {
          "*": "deny"
        },
        "bash": {
          "*": "deny"
        },
        "*": "deny"
      }
    },
    "task-lead": {
      "mode": "subagent",
      "hidden": true,
      "description": "Single-task orchestrator for bounded local complexity with max depth one.",
      "prompt": "{file:./.opencode/agents/task-lead.md}",
      "permission": {
        "task": {
          "*": "deny",
          "explore": "allow",
          "librarian": "allow"
        },
        "edit": {
          "*": "allow"
        },
        "bash": { ...PERMISSIVE_BASH_PERMISSION }
      }
    },
    "explore": {
      "mode": "subagent",
      "hidden": true,
      "description": "Read-only local exploration of files, structure, and code context.",
      "prompt": "{file:./.opencode/agents/explore.md}",
      "permission": {
        "task": {
          "*": "deny"
        },
        "edit": {
          "*": "deny"
        },
        "bash": { ...PERMISSIVE_BASH_PERMISSION },
        "webfetch": "deny",
        "websearch": "deny"
      }
    },
    "librarian": {
      "mode": "subagent",
      "hidden": true,
      "description": "External documentation and OSS reference lookup with no edit authority.",
      "prompt": "{file:./.opencode/agents/librarian.md}",
      "permission": {
        "task": {
          "*": "deny"
        },
        "edit": {
          "*": "deny"
        },
        "bash": { ...PERMISSIVE_BASH_PERMISSION },
        "webfetch": "allow",
        "websearch": "allow"
      }
    },
    "plan-review": {
      "mode": "subagent",
      "hidden": true,
      "description": "Plan review specialist that evaluates plan artifacts and may request read-only Explore evidence.",
      "prompt": "{file:./.opencode/agents/plan-review.md}",
      "permission": {
        "task": {
          "*": "deny",
          "explore": "allow"
        },
        "edit": {
          "*": "deny"
        },
        "bash": { ...PERMISSIVE_BASH_PERMISSION }
      }
    },
    "result-review": {
      "mode": "subagent",
      "hidden": true,
      "description": "Optional result review specialist for Command Lead execution summaries, with read-only Explore evidence when needed.",
      "prompt": "{file:./.opencode/agents/result-review.md}",
      "permission": {
        "task": {
          "*": "deny",
          "explore": "allow"
        },
        "edit": {
          "*": "deny"
        },
        "bash": { ...PERMISSIVE_BASH_PERMISSION }
      }
    }
  }
};
