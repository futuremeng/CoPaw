/**
 * copawRoutes.tsx — routes for the pages CoPaw has and upstream does not.
 *
 * Upstream moved the route table out of MainLayout into routeRegistry
 * (layouts/registry/builtinRoutes.tsx). The fork's own pages register here so a
 * sync never has to re-merge a nav table inside an upstream-owned file.
 */
import { lazyImportWithRetry } from "../../utils/lazyWithRetry";
import { routeRegistry } from "../../plugins/registry/store";
import type { Route } from "../../plugins/registry/types";

const KnowledgePage = lazyImportWithRetry("../../pages/Agent/Knowledge");
const ProjectsListPage = lazyImportWithRetry(
  "../../pages/Agent/Projects/ProjectsListPage",
);
const ProjectDetailPage = lazyImportWithRetry(
  "../../pages/Agent/Projects/ProjectDetailPage",
);
const PipelinesPage = lazyImportWithRetry("../../pages/Agent/Pipelines");
const NlpPage = lazyImportWithRetry("../../pages/Settings/Nlp");

export const COPAW_ROUTES: Route[] = [
  { id: "copaw.knowledge", path: "/knowledge", component: KnowledgePage },
  { id: "copaw.projects", path: "/projects", component: ProjectsListPage },
  {
    id: "copaw.project-detail",
    path: "/projects/:projectId",
    component: ProjectDetailPage,
  },
  {
    id: "copaw.project-chat",
    path: "/projects/:projectId/chat/:chatId",
    component: ProjectDetailPage,
  },
  { id: "copaw.pipelines", path: "/pipelines", component: PipelinesPage },
  { id: "copaw.nlp", path: "/nlp", component: NlpPage },
];

for (const route of COPAW_ROUTES) {
  routeRegistry.add("copaw", route);
}
