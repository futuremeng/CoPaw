export function buildAutoAttachAnalysisPrompt(params: {
  projectName: string;
  workspaceDir?: string;
  fileNames: string[];
  selectedRunId?: string;
  fileContexts?: Array<{ path: string; excerpt: string }>;
}): string {
  const fileRefs = params.fileNames.slice(0, 8).map((name, index) => ({
    id: `F${index + 1}`,
    path: name,
    name: name.split("/").pop() || name,
  }));

  const fileList = fileRefs
    .map((item) => `${item.id}. ${item.name} (${item.path})`)
    .join("\n");

  const modeHint = params.selectedRunId
    ? "这些文件与当前运行上下文相关。"
    : "这些文件与当前项目设计上下文相关。";

  const workspaceDir = (params.workspaceDir || "").trim();
  const absoluteFileList = workspaceDir
    ? fileRefs
        .map(
          (item) =>
            `${item.id}. ${workspaceDir.replace(/\/$/, "")}/${item.path.replace(/^\//, "")}`,
        )
        .join("\n")
    : "";

  const contextItems = Array.isArray(params.fileContexts)
    ? params.fileContexts.slice(0, 8)
    : [];

  return [
    `我选择了 ${params.fileNames.length} 个项目文件，先做一轮合并判断。`,
    `项目：${params.projectName}`,
    modeHint,
    ...(workspaceDir
      ? [
          `项目工作区绝对路径（workspace root）：${workspaceDir}`,
          "读文件规则：若需要读文件，请使用 workspace root + 相对路径 组合成绝对路径。",
        ]
      : []),
    "文件引用：",
    fileList,
    ...(absoluteFileList
      ? [
          "可读绝对路径：",
          absoluteFileList,
        ]
      : []),
    ...(contextItems.length > 0
      ? [
          "以下是可直接使用的文件内容片段（已截断）：",
          contextItems
            .map(
              (item, index) =>
                `${fileRefs[index]?.id || `F${index + 1}`}\n---\n${item.excerpt}`,
            )
            .join("\n\n"),
        ]
      : []),
    "任务：先判断我当前最可能的目标/需求。",
    "输出：用 2-4 条要点给出你的判断，并给出下一步建议。",
    "若信息不足：最后只补 1 个简短澄清问题；若信息足够：直接继续分析。",
  ].join("\n");
}

export function buildAttachDraftPrompt(params: {
  projectName: string;
  workspaceDir?: string;
  selectedRunId?: string;
  selectedFiles: Array<{ path: string; size: number }>;
}): string {
  const modeHint = params.selectedRunId
    ? `当前运行：${params.selectedRunId}`
    : "当前上下文：流程设计";

  const fileRefs = params.selectedFiles.map((item, index) => {
    const name = item.path.split("/").pop() || item.path;
    return {
      id: `F${index + 1}`,
      name,
      path: item.path,
      size: item.size,
    };
  });

  const fileList = fileRefs
    .map((item) => `${item.id}. ${item.name} (${item.path}, ${item.size} bytes)`)
    .join("\n");

  const workspaceDir = (params.workspaceDir || "").trim();
  const absoluteFileList = workspaceDir
    ? fileRefs
        .map(
          (item) =>
            `${item.id}. ${workspaceDir.replace(/\/$/, "")}/${item.path.replace(/^\//, "")}`,
        )
        .join("\n")
    : "";

  return [
    `我已选择 ${params.selectedFiles.length} 个项目文件作为当前上下文参考。`,
    `项目：${params.projectName}`,
    modeHint,
    ...(workspaceDir
      ? [
          `项目工作区绝对路径（workspace root）：${workspaceDir}`,
          "读文件规则：若需要读文件，请使用 workspace root + 相对路径 组合成绝对路径。",
        ]
      : []),
    "文件引用：",
    fileList,
    ...(absoluteFileList
      ? [
          "可读绝对路径：",
          absoluteFileList,
        ]
      : []),
    "请直接继续分析当前任务，并给出下一步建议。",
  ].join("\n");
}

export function buildImplementationAdvancePrompt(params: {
  projectName: string;
  templateName: string;
  templateId: string;
  runCount: number;
  latestRunStatus: string;
  gateSummary: string;
}): string {
  return [
    `我们继续以“对话驱动”方式推进项目流程构建。项目：${params.projectName}`,
    `当前流程：${params.templateName} (${params.templateId})`,
    `当前运行数：${params.runCount}，最近一次运行状态：${params.latestRunStatus || "none"}`,
    `验证门槛现状：${params.gateSummary}`,
    "请你输出下一轮实施计划（不是最终模板），要求：",
    "1) 仅调整最小必要步骤；",
    "2) 对每一步明确 inputs / outputs / depends_on / retry_policy；",
    "3) 说明本轮要验证的假设与成功判定；",
    "4) 最后给出‘我下一步该点击什么（Run / Attach / 继续对话）’。",
  ].join("\n");
}

export function buildValidationRoundPrompt(params: {
  projectName: string;
  runId: string;
  templateName: string;
  gateSummary: string;
}): string {
  return [
    `请基于当前运行做一次“验证导向”复盘。项目：${params.projectName}`,
    `运行：${params.runId}，流程：${params.templateName}`,
    `当前门槛状态：${params.gateSummary}`,
    "请输出：",
    "1) 通过项 / 失败项（逐步列出）；",
    "2) 每个失败项的最小修复动作；",
    "3) 是否建议立即重跑；若是，给出重跑前必须修改的项；",
    "4) 用一句话判断：是否已到‘可吸收为模板’时机。",
  ].join("\n");
}

export function buildPromotionDraftPrompt(params: {
  projectName: string;
  templateName: string;
  templateId: string;
  runId: string;
}): string {
  return [
    `我们准备把已验证成果吸收为模板草案。项目：${params.projectName}`,
    `目标模板：${params.templateName} (${params.templateId})，依据运行：${params.runId}`,
    "请输出结构化模板草案（不是解释文），要求：",
    "1) 仅保留已验证通过的步骤；",
    "2) 每步必须含 id/name/kind/inputs/outputs/depends_on/input_bindings/retry_policy；",
    "3) 标注本次吸收剔除的步骤及原因；",
    "4) 最后给一段简短变更摘要，便于我人工确认后保存。",
  ].join("\n");
}
