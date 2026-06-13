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

const AGENT_MODELS_COMMAND_TEMPLATE = `Configure Oh My Lite OpenAgent role models.

Workflow:
1. Import the model pool; this includes every discovered provider, including OpenCode subscription providers such as opencode and opencode-go:
   bounded_lite_model_config({ action: "import" })
2. Preview recommendations only:
   bounded_lite_model_config({ action: "auto" })
   action=auto is recommendation-only and includes Task Lead profile recommendations.
3. Show the pool and recommendations, ask whether they want changes, and only choose IDs returned by import/auto.
4. Apply after approval with assignments and taskLeadProfileAssignments. Only include reasoningEffortAssignments when the user explicitly asks to persist reasoning effort; otherwise leave OpenCode's current Ctrl+T/session selection in control.

Do not create new Task Lead agents; profiles are dispatch metadata for the single hidden task-lead agent.`;

const GO_COMMAND_TEMPLATE = `Run Go Protocol for this user goal:
$ARGUMENTS

Treat $ARGUMENTS as the user's goal and work as a non-interactive agentic goal-completion workflow through command-lead.

Workflow:
1. Infer practical acceptance criteria from the goal and repository conventions without asking clarification or preference questions.
2. Gather scoped evidence before touching sensitive surfaces, then choose the lightest safe strategy: direct execution, bounded planning, or delegated subtasks.
3. Implement the goal, verify the result, and continue until verification and acceptance criteria succeed.
4. Close with a concise summary of what changed and any remaining limitations.

Do not commit, push, publish, perform destructive actions, or write external/user-local config unless the user explicitly requested that action in the goal.
If a safety, permission, missing-secret, impossible-condition, or explicit-authorization hard blocker prevents completion, stop and return a blocked report naming the blocker and the required authorization or condition.`;

const STUDY_COMMAND_TEMPLATE = `Run Study Protocol for final exam review materials:
$ARGUMENTS

Treat the current OpenCode working directory as the courseware directory. Discover only first-level .ppt, .pptx, and .pdf files with bounded_lite_study_ingest, generate the review package with bounded_lite_study_package, and do not recursively scan subdirectories.

Workflow:
1. Parse $ARGUMENTS for subject, exam style, scope, and any user constraints; if missing, infer practical defaults from filenames and current-directory courseware.
2. Use courseware as the canonical source. Librarian/external explanations are allowed only as supplemental context and every non-courseware item must be marked [External].
3. Run bounded_lite_study_package with stage="sources" first to create AGENTS.md, source-index.json, coverage-report.md, and source-faithful sources/ notes for extraction review; after the source layer is acceptable, run the full package stage for study-guide.md, exam-points.md, mindmap.md, anki_flashcards.csv, practice-questions.md, summaries/, reviews/, and repairs/.
4. Preserve existing AGENTS.md content. Update only the <!-- oh-my-lite-study:start --> to <!-- oh-my-lite-study:end --> managed block; append the block if no markers exist; stop with a recoverable blocker for missing, duplicate, reversed, or nested markers.
5. For each deck or slice, keep source-faithful notes in sources/<deck>.md and exam-focused summaries in summaries/<deck>.md. Use extractionQuality, confidence, and needsManualReview to flag low-text or text-sparse pages instead of inventing missing content.
6. Integrate at most three Task Lead results into a Command Lead-owned batch summary before Result Review; after all batches pass, review the Command Lead-owned final integrated result.

Safety boundaries:
- Do not write study outputs outside the current courseware directory unless the user explicitly authorizes it.
- Do not write study outputs into .opencode/ or .liteagent/.
- Do not ingest generated study outputs or recurse into sources/, summaries/, reviews/, repairs/, .opencode/, or .liteagent/.
- PDF extraction prefers optional pdftotext when available and falls back to built-in literal text extraction.
- Legacy .ppt is converted through LibreOffice/soffice when available; if conversion is unavailable or fails, return a recoverable blocker instead of silently skipping it.
- /study is a command workflow through command-lead, not a new OpenCode mode or agent.`;

export const MANAGED_CONFIG = {
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "command-lead",
  "command": {
    "agent-models": {
      "description": "Configure per-role models and Task Lead profile assignments with bounded_lite_model_config.",
      "agent": "command-lead",
      "template": AGENT_MODELS_COMMAND_TEMPLATE
    },
    "go": {
      "description": "Run a non-interactive agentic goal workflow through Command Lead.",
      "agent": "command-lead",
      "template": GO_COMMAND_TEMPLATE
    },
    "study": {
      "description": "Generate a current-directory final exam review project from .ppt, .pptx, and .pdf courseware.",
      "agent": "command-lead",
      "template": STUDY_COMMAND_TEMPLATE
    }
  },
  "mcp": {
    "context7": {
      "type": "local",
      "command": ["npx", "-y", "@upstash/context7-mcp"]
    },
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp"]
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
        "question": "allow",
        "task": {
          "*": "deny",
          "plan-builder": "allow",
          "deep-plan-builder": "allow",
          "task-lead": "allow",
          "explore": "allow",
          "librarian": "allow",
          "plan-review": "allow",
          "result-review": "allow"
        }
      }
    },
    "plan-builder": {
      "mode": "all",
      "description": "Visible planner with explicit discussion mode for user-facing planning and internal normalize mode for stable skeleton convergence.",
      "prompt": "{file:./.opencode/agents/plan-builder.md}",
      "permission": {
        "question": "allow",
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
        }
      }
    },
    "deep-plan-builder": {
      "mode": "all",
      "color": "#ff0000",
      "description": "Visible deep planner that produces detailed handoff plans for lower-strength executors with mandatory plan review.",
      "prompt": "{file:./.opencode/agents/deep-plan-builder.md}",
      "permission": {
        "question": "allow",
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
        }
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
        }
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
        }
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
        }
      }
    }
  }
};
