import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import i18n from "../../../i18n";
import {
  graphSortFieldOptions,
  graphSortOrderOptions,
  knowledgeScopeOptions,
  sourceTypeOptions,
  weightLegendLabels,
} from "./selectLabels";

// Rendered through the product's own i18n instance so the overlay registration
// order production uses is what proves each arm.
function translateIn(lng: string): TFunction {
  return ((key: string) => i18n.t(key, { lng })) as unknown as TFunction;
}

const SOURCE_TYPES = ["file", "directory", "url", "text", "chat"] as const;
const SCOPES = ["combined", "agent", "project"] as const;
const SORT_FIELDS = ["score", "subject", "title"] as const;
const SORT_ORDERS = ["descend", "ascend"] as const;

// zh keeps "Agent" as the product term, so this table is the authority rather
// than a "must differ from en" rule (judgment 83).
const EXPECTED: Record<
  string,
  {
    sourceType: string[];
    scope: string[];
    sortField: string[];
    sortOrder: string[];
    weight: string[];
    oneOff: Record<string, string>;
  }
> = {
  en: {
    sourceType: ["File", "Directory", "URL", "Text", "Chat"],
    scope: ["Combined", "Agent", "Project"],
    sortField: ["Score", "Subject", "Document Title"],
    sortOrder: ["Descending", "Ascending"],
    weight: ["Low", "Mid", "High"],
    oneOff: {
      "knowledge.graphQuery.scope": "Scope",
      "knowledge.graphQuery.scopeId": "Scope ID",
      "knowledge.graphQuery.nodeId": "Node ID",
      "knowledge.graphQuery.scopeIdOptional": "optional",
      "knowledge.table.remote": "Remote",
      "projects.pipeline.totalSteps": "Total Steps",
      "projects.pipeline.noMetrics": "No metrics",
      "projects.pipeline.status.completed": "Completed",
      "projects.pipeline.status.running": "Running",
      "projects.pipeline.status.pending": "Pending",
      "nlpConfig.demo.schemaJson": "Schema JSON",
    },
  },
  zh: {
    sourceType: ["文件", "文件夹", "网址", "文本", "聊天"],
    scope: ["合并", "Agent", "项目"],
    sortField: ["分数", "主语", "文档标题"],
    sortOrder: ["降序", "升序"],
    weight: ["低", "中", "高"],
    oneOff: {
      "knowledge.graphQuery.scope": "范围",
      "knowledge.graphQuery.scopeId": "范围 ID",
      "knowledge.graphQuery.nodeId": "节点 ID",
      "knowledge.graphQuery.scopeIdOptional": "可选",
      "knowledge.table.remote": "远端",
      "projects.pipeline.totalSteps": "总步骤数",
      "projects.pipeline.noMetrics": "无指标",
      "projects.pipeline.status.completed": "已完成",
      "projects.pipeline.status.running": "运行中",
      "projects.pipeline.status.pending": "待执行",
      "nlpConfig.demo.schemaJson": "输出结构（JSON）",
    },
  },
};

describe.each(["en", "zh"] as const)("%s select labels", (lng) => {
  const t = translateIn(lng);
  const expected = EXPECTED[lng];

  it("labels every knowledge source type", () => {
    expect(sourceTypeOptions(t)).toEqual(
      SOURCE_TYPES.map((value, index) => ({
        label: expected.sourceType[index],
        value,
      })),
    );
  });

  it("labels every knowledge scope filter", () => {
    expect(knowledgeScopeOptions(t)).toEqual(
      SCOPES.map((value, index) => ({
        label: expected.scope[index],
        value,
      })),
    );
  });

  it("labels every graph sort field", () => {
    expect(graphSortFieldOptions(t)).toEqual(
      SORT_FIELDS.map((value, index) => ({
        label: expected.sortField[index],
        value,
      })),
    );
  });

  it("labels every graph sort order", () => {
    expect(graphSortOrderOptions(t)).toEqual(
      SORT_ORDERS.map((value, index) => ({
        label: expected.sortOrder[index],
        value,
      })),
    );
  });

  it("labels every weight legend item", () => {
    expect(weightLegendLabels(t)).toEqual({
      low: expected.weight[0],
      mid: expected.weight[1],
      high: expected.weight[2],
    });
  });

  it("supplies every one-off label the pages render", () => {
    for (const [key, value] of Object.entries(expected.oneOff)) {
      expect(i18n.t(key, { lng })).toBe(value);
    }
  });
});

// Judgment 80's mirror: a rendered string with no key is invisible to the locale
// gate, and a key with no host reader is invisible in the other direction. So each
// host is pinned by the call sites it must contain, not by literals it must avoid —
// `"Scope:"` as a forbidden literal would also reject `datasetScope:` in payload code.
describe("knowledge pages read their control labels from the bundle", () => {
  const hosts: Array<{
    path: string;
    callSites: string[];
    noOptionLiterals?: boolean;
  }> = [
    {
      path: "./index.tsx",
      callSites: [
        't("knowledge.graphQuery.scope")',
        't("knowledge.graphQuery.scopeId")',
        't("knowledge.graphQuery.nodeId")',
        't("knowledge.graphQuery.scopeIdOptional")',
        't("knowledge.table.remote")',
        "sourceTypeOptions(t)",
        "knowledgeScopeOptions(t)",
      ],
      noOptionLiterals: true,
    },
    {
      path: "./graphVisualization.tsx",
      callSites: [
        "graphSortFieldOptions(t)",
        "graphSortOrderOptions(t)",
        "weightLegendLabels(t)",
      ],
      noOptionLiterals: true,
    },
    {
      path: "../Projects/components/ProjectMetricsPanel.tsx",
      callSites: [
        't("projects.pipeline.totalSteps")',
        't("projects.pipeline.noMetrics")',
        't("projects.pipeline.status.completed")',
        't("projects.pipeline.status.running")',
        't("projects.pipeline.status.pending")',
      ],
    },
    {
      path: "../../Settings/Nlp/index.tsx",
      callSites: ['t("nlpConfig.demo.schemaJson")'],
    },
  ];

  for (const host of hosts) {
    it(`${host.path} reads every label through the bundle`, () => {
      const source = readFileSync(new URL(host.path, import.meta.url), "utf8");
      for (const callSite of host.callSites) {
        expect(source).toContain(callSite);
      }
      if (host.noOptionLiterals) {
        expect(source).not.toContain('label: "');
      }
    });
  }
});
