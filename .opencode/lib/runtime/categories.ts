import type { RoleName, RoutingCategory, VisibleMode } from "../contracts.js";

export interface CategoryRoute {
  category: RoutingCategory;
  targetRole: RoleName;
  visibleMode?: VisibleMode;
}

export const CATEGORY_ROUTES: Readonly<Record<RoutingCategory, CategoryRoute>> = {
  execution: {
    category: "execution",
    targetRole: "command-lead",
    visibleMode: "execution",
  },
  planning: {
    category: "planning",
    targetRole: "plan-builder",
    visibleMode: "planning",
  },
  "deep-planning": {
    category: "deep-planning",
    targetRole: "deep-plan-builder",
    visibleMode: "deep-planning",
  },
  explore: {
    category: "explore",
    targetRole: "explore",
  },
  librarian: {
    category: "librarian",
    targetRole: "librarian",
  },
  "plan-review": {
    category: "plan-review",
    targetRole: "plan-review",
  },
  "result-review": {
    category: "result-review",
    targetRole: "result-review",
  },
};

export function resolveCategoryRoute(category: RoutingCategory): CategoryRoute {
  return CATEGORY_ROUTES[category];
}

export function isVisibleCategory(category: RoutingCategory): boolean {
  return Boolean(CATEGORY_ROUTES[category].visibleMode);
}
