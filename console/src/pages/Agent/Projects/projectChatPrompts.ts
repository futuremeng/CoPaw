export function buildAutoAttachAnalysisPrompt(params: {
  projectName: string;
  fileNames: string[];
  selectedRunId?: string;
}): string {
  const fileList = params.fileNames
    .slice(0, 8)
    .map((name, index) => `${index + 1}. ${name}`)
    .join("\n");
  const modeHint = params.selectedRunId
    ? "这些文件与当前运行上下文相关。"
    : "这些文件与当前项目设计上下文相关。";
  return [
    `我刚刚附加了 ${params.fileNames.length} 个项目文件，请合并分析。`,
    `项目：${params.projectName}`,
    modeHint,
    "文件列表：",
    fileList,
    "请先根据文件名和内容猜测我最可能的目标或需求，再用 2-4 条要点总结你的判断和建议下一步。",
    "如果信息不足，最后只补一个简短澄清问题；如果已经足够，就直接继续分析。",
  ].join("\n");
}

export function buildAttachDraftPrompt(params: {
  projectName: string;
  selectedRunId?: string;
  selectedFiles: Array<{ path: string; size: number }>;
}): string {
  const modeHint = params.selectedRunId
    ? `当前运行：${params.selectedRunId}`
    : "当前上下文：流程设计";
  const fileList = params.selectedFiles
    .map((item, index) => `${index + 1}. ${item.path} (${item.size} bytes)`)
    .join("\n");
  return [
    `我已选择 ${params.selectedFiles.length} 个项目文件作为上下文。`,
    `项目：${params.projectName}`,
    modeHint,
    "文件列表：",
    fileList,
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
