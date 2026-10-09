/**
 * copawMenu.ts — sidebar entries for the pages CoPaw has and upstream does not.
 *
 * Mirrors layouts/registry/builtinMenu.ts: items are plain data registered into
 * menuRegistry, and they nest inside upstream's own groups by `parentId`.
 * Keeping them out of builtinMenu.ts is what makes the next sync cheap.
 */
import { Activity, BookOpen, Briefcase, ScanSearch } from "lucide-react";
import i18next from "../../i18n";
import { menuRegistry } from "../../plugins/registry/store";
import type { MenuItem } from "../../plugins/registry/types";

const navLabel = (key: string, defaultValue?: string) => (): string =>
  i18next.t(key, defaultValue ?? key);

export const COPAW_MENU: MenuItem[] = [
  {
    id: "copaw.projects",
    location: "primary.agentScoped",
    parentId: "core.workspace-group",
    label: navLabel("nav.projects"),
    icon: Briefcase,
    route: "copaw.projects",
    order: 6,
  },
  {
    id: "copaw.pipelines",
    location: "primary.agentScoped",
    parentId: "core.workspace-group",
    label: navLabel("nav.pipelines"),
    icon: Activity,
    route: "copaw.pipelines",
    order: 7,
  },
  {
    id: "copaw.knowledge",
    location: "primary.agentScoped",
    parentId: "core.workspace-group",
    label: navLabel("nav.knowledge"),
    icon: BookOpen,
    route: "copaw.knowledge",
    order: 8,
  },
  {
    id: "copaw.nlp",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.nlp"),
    icon: ScanSearch,
    route: "copaw.nlp",
    order: 95,
  },
];

for (const item of COPAW_MENU) {
  menuRegistry.add("copaw", item);
}
