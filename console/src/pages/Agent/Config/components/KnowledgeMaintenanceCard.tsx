import { Card, Form, Input, InputNumber, Switch } from "@agentscope-ai/design";
import { useTranslation } from "react-i18next";
import styles from "../index.module.less";

export function KnowledgeMaintenanceCard() {
  const { t } = useTranslation();
  const autoCollectLongText = Form.useWatch("auto_collect_long_text");

  return (
    <Card
      className={styles.formCard}
      title={t("agentConfig.knowledgeMaintenanceTitle")}
      style={{ marginTop: 16 }}
    >
      <Form.Item
        label={t("agentConfig.autoCollectChatFiles")}
        name="auto_collect_chat_files"
        valuePropName="checked"
        tooltip={t("agentConfig.autoCollectChatFilesTooltip")}
      >
        <Switch />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.autoCollectChatUrls")}
        name="auto_collect_chat_urls"
        valuePropName="checked"
        tooltip={t("agentConfig.autoCollectChatUrlsTooltip")}
      >
        <Switch />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.autoCollectLongText")}
        name="auto_collect_long_text"
        valuePropName="checked"
        tooltip={t("agentConfig.autoCollectLongTextTooltip")}
      >
        <Switch />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.longTextMinChars")}
        name="long_text_min_chars"
        rules={[
          {
            required: true,
            message: t("agentConfig.longTextMinCharsRequired"),
          },
          {
            type: "number",
            min: 200,
            message: t("agentConfig.longTextMinCharsMin"),
          },
        ]}
        tooltip={t("agentConfig.longTextMinCharsTooltip")}
      >
        <InputNumber
          style={{ width: "100%" }}
          min={200}
          max={20000}
          step={100}
          disabled={!autoCollectLongText}
          placeholder={t("agentConfig.longTextMinCharsPlaceholder")}
        />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.knowledgeChunkSize")}
        name="knowledge_chunk_size"
        rules={[
          {
            required: true,
            message: t("agentConfig.knowledgeChunkSizeRequired"),
          },
          {
            type: "number",
            min: 200,
            message: t("agentConfig.knowledgeChunkSizeMin"),
          },
        ]}
        tooltip={t("agentConfig.knowledgeChunkSizeTooltip")}
      >
        <InputNumber
          style={{ width: "100%" }}
          min={200}
          max={8000}
          step={100}
          placeholder={t("agentConfig.knowledgeChunkSizePlaceholder")}
        />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.knowledgeMaintenanceLlmYieldSeconds")}
        name="knowledge_maintenance_llm_yield_seconds"
        rules={[
          {
            required: true,
            message: t("agentConfig.knowledgeMaintenanceLlmYieldSecondsRequired"),
          },
          {
            type: "number",
            min: 0,
            message: t("agentConfig.knowledgeMaintenanceLlmYieldSecondsMin"),
          },
        ]}
        tooltip={t("agentConfig.knowledgeMaintenanceLlmYieldSecondsTooltip")}
      >
        <InputNumber
          style={{ width: "100%" }}
          min={0}
          max={30}
          step={0.5}
          placeholder={t("agentConfig.knowledgeMaintenanceLlmYieldSecondsPlaceholder")}
        />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSeconds")}
        name="knowledge_title_regen_adaptive_active_window_seconds"
        rules={[
          {
            required: true,
            message: t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSecondsRequired"),
          },
          {
            type: "number",
            min: 0,
            message: t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSecondsMin"),
          },
        ]}
        tooltip={t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSecondsTooltip")}
      >
        <InputNumber
          style={{ width: "100%" }}
          min={0}
          max={600}
          step={1}
          placeholder={t("agentConfig.knowledgeTitleRegenAdaptiveActiveWindowSecondsPlaceholder")}
        />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSeconds")}
        name="knowledge_title_regen_adaptive_burst_window_seconds"
        rules={[
          {
            required: true,
            message: t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSecondsRequired"),
          },
          {
            type: "number",
            min: 0,
            message: t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSecondsMin"),
          },
        ]}
        tooltip={t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSecondsTooltip")}
      >
        <InputNumber
          style={{ width: "100%" }}
          min={0}
          max={300}
          step={1}
          placeholder={t("agentConfig.knowledgeTitleRegenAdaptiveBurstWindowSecondsPlaceholder")}
        />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplier")}
        name="knowledge_title_regen_adaptive_active_multiplier"
        rules={[
          {
            required: true,
            message: t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplierRequired"),
          },
          {
            type: "number",
            min: 1,
            message: t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplierMin"),
          },
        ]}
        tooltip={t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplierTooltip")}
      >
        <InputNumber
          style={{ width: "100%" }}
          min={1}
          max={10}
          step={0.1}
          placeholder={t("agentConfig.knowledgeTitleRegenAdaptiveActiveMultiplierPlaceholder")}
        />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplier")}
        name="knowledge_title_regen_adaptive_burst_multiplier"
        rules={[
          {
            required: true,
            message: t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplierRequired"),
          },
          {
            type: "number",
            min: 1,
            message: t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplierMin"),
          },
        ]}
        tooltip={t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplierTooltip")}
      >
        <InputNumber
          style={{ width: "100%" }}
          min={1}
          max={10}
          step={0.1}
          placeholder={t("agentConfig.knowledgeTitleRegenAdaptiveBurstMultiplierPlaceholder")}
        />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.knowledgeTitleRegenPrompt")}
        name="knowledge_title_regen_prompt"
        rules={[
          {
            required: true,
            message: t("agentConfig.knowledgeTitleRegenPromptRequired"),
          },
        ]}
        tooltip={t("agentConfig.knowledgeTitleRegenPromptTooltip")}
      >
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={500}
          placeholder={t("agentConfig.knowledgeTitleRegenPromptPlaceholder")}
        />
      </Form.Item>

      <Form.Item
        label={t("agentConfig.autoBackfillHistoryData")}
        name="auto_backfill_history_data"
        valuePropName="checked"
        tooltip={t("agentConfig.autoBackfillHistoryDataTooltip")}
      >
        <Switch />
      </Form.Item>
    </Card>
  );
}
