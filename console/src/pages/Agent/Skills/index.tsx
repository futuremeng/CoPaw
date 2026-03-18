import { useState, useRef } from "react";
import { Button, Form, Modal, message } from "@agentscope-ai/design";
import {
  DownloadOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { SkillSpec } from "../../../api/types";
import { SkillCard, SkillDrawer } from "./components";
import { useSkills } from "./useSkills";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";

function SkillsPage() {
  const { t } = useTranslation();
  const {
    skills,
    marketplace,
    marketErrors,
    marketMeta,
    loading,
    uploading,
    marketplaceLoading,
    installingSkillKey,
    importing,
    cancelImport,
    fetchMarketplace,
    installMarketplaceSkill,
    createSkill,
    uploadSkill,
    importFromHub,
    toggleEnabled,
    deleteSkill,
  } = useSkills();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importUrlError, setImportUrlError] = useState("");
  const [editingSkill, setEditingSkill] = useState<SkillSpec | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [form] = Form.useForm<SkillSpec>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_UPLOAD_SIZE_MB = 100;

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected
    e.target.value = "";

    if (!file.name.toLowerCase().endsWith(".zip")) {
      message.warning(t("skills.zipOnly"));
      return;
    }

    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_UPLOAD_SIZE_MB) {
      message.warning(
        t("skills.fileSizeExceeded", { size: sizeMB.toFixed(1) }),
      );
      return;
    }

    await uploadSkill(file);
  };

  const supportedSkillUrlPrefixes = [
    "https://skills.sh/",
    "https://clawhub.ai/",
    "https://skillsmp.com/",
    "https://lobehub.com/",
    "https://market.lobehub.com/",
    "https://github.com/",
    "https://modelscope.cn/skills/",
  ];

  const isSupportedSkillUrl = (url: string) => {
    return supportedSkillUrlPrefixes.some((prefix) => url.startsWith(prefix));
  };

  const handleCreate = () => {
    setEditingSkill(null);
    form.resetFields();
    form.setFieldsValue({
      enabled: false,
    });
    setDrawerOpen(true);
  };

  const closeImportModal = () => {
    if (importing) {
      return;
    }
    setImportModalOpen(false);
    setImportUrl("");
    setImportUrlError("");
  };

  const handleImportFromHub = () => {
    setImportModalOpen(true);
  };

  const handleImportUrlChange = (value: string) => {
    setImportUrl(value);
    const trimmed = value.trim();
    if (trimmed && !isSupportedSkillUrl(trimmed)) {
      setImportUrlError(t("skills.invalidSkillUrlSource"));
      return;
    }
    setImportUrlError("");
  };

  const handleConfirmImport = async () => {
    if (importing) return;
    const trimmed = importUrl.trim();
    if (!trimmed) return;
    if (!isSupportedSkillUrl(trimmed)) {
      setImportUrlError(t("skills.invalidSkillUrlSource"));
      return;
    }
    const success = await importFromHub(trimmed);
    if (success) {
      closeImportModal();
    }
  };

  const handleEdit = (skill: SkillSpec) => {
    setEditingSkill(skill);
    form.setFieldsValue(skill);
    setDrawerOpen(true);
  };

  const handleToggleEnabled = async (skill: SkillSpec, e: React.MouseEvent) => {
    e.stopPropagation();
    await toggleEnabled(skill);
  };

  const handleDelete = async (skill: SkillSpec, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await deleteSkill(skill);
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setEditingSkill(null);
  };

  const handleSubmit = async (values: { name: string; content: string }) => {
    try {
      const success = await createSkill(values.name, values.content);
      if (success) {
        setDrawerOpen(false);
      }
    } catch (error) {
      console.error("Submit failed", error);
    }
  };

  const handleInstallMarketplaceSkill = async (
    marketId: string,
    skillId: string,
  ) => {
    await installMarketplaceSkill(marketId, skillId, {
      enable: true,
      overwrite: false,
    });
  };

  return (
    <div className={styles.skillsPage}>
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <h1 className={styles.title}>{t("skills.title")}</h1>
          <p className={styles.description}>{t("skills.description")}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="file"
            accept=".zip"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          <Button
            type="primary"
            onClick={handleUploadClick}
            icon={<UploadOutlined />}
            loading={uploading}
            disabled={uploading}
          >
            {t("skills.uploadSkill")}
          </Button>
          <Button
            type="primary"
            onClick={handleImportFromHub}
            icon={<DownloadOutlined />}
          >
            {t("skills.importSkills")}
          </Button>
          <Button type="primary" onClick={handleCreate} icon={<PlusOutlined />}>
            {t("skills.createSkill")}
          </Button>
        </div>
      </div>

      <Modal
        title={t("skills.importSkills")}
        open={importModalOpen}
        onCancel={closeImportModal}
        maskClosable={!importing}
        closable={!importing}
        keyboard={!importing}
        footer={
          <div style={{ textAlign: "right" }}>
            <Button
              onClick={importing ? cancelImport : closeImportModal}
              style={{ marginRight: 8 }}
            >
              {t(importing ? "skills.cancelImport" : "common.cancel")}
            </Button>
            <Button
              type="primary"
              onClick={handleConfirmImport}
              loading={importing}
              disabled={importing || !importUrl.trim() || !!importUrlError}
            >
              {t("skills.importSkills")}
            </Button>
          </div>
        }
        width={760}
      >
        <div className={styles.importHintBlock}>
          <p className={styles.importHintTitle}>
            {t("skills.supportedSkillUrlSources")}
          </p>
          <ul className={styles.importHintList}>
            <li>https://skills.sh/</li>
            <li>https://clawhub.ai/</li>
            <li>https://skillsmp.com/</li>
            <li>https://lobehub.com/</li>
            <li>https://market.lobehub.com/</li>
            <li>https://github.com/</li>
            <li>https://modelscope.cn/skills/</li>
          </ul>
          <p className={styles.importHintTitle}>{t("skills.urlExamples")}</p>
          <ul className={styles.importHintList}>
            <li>https://skills.sh/vercel-labs/skills/find-skills</li>
            <li>https://lobehub.com/zh/skills/openclaw-skills-cli-developer</li>
            <li>
              https://market.lobehub.com/api/v1/skills/openclaw-skills-cli-developer/download
            </li>
            <li>
              https://github.com/anthropics/skills/tree/main/skills/skill-creator
            </li>
            <li>https://modelscope.cn/skills/@anthropics/skill-creator</li>
          </ul>
        </div>

        <input
          className={styles.importUrlInput}
          value={importUrl}
          onChange={(e) => handleImportUrlChange(e.target.value)}
          placeholder={t("skills.enterSkillUrl")}
          disabled={importing}
        />
        {importUrlError ? (
          <div className={styles.importUrlError}>{importUrlError}</div>
        ) : null}
        {importing ? (
          <div className={styles.importLoadingText}>{t("common.loading")}</div>
        ) : null}
      </Modal>

      <div className={styles.marketplacePanel}>
        <div className={styles.marketplaceHeader}>
          <div>
            <h2 className={styles.marketplaceTitle}>Skills Marketplace</h2>
            <p className={styles.marketplaceDesc}>
              Install skills from configured markets.
            </p>
          </div>
          <Button
            onClick={() => {
              void fetchMarketplace(true);
            }}
            loading={marketplaceLoading}
          >
            Refresh
          </Button>
        </div>

        {marketMeta ? (
          <div className={styles.marketMetaRow}>
            <span>Markets: {marketMeta.enabled_market_count}</span>
            <span>Healthy: {marketMeta.success_market_count}</span>
            <span>Items: {marketMeta.item_count}</span>
          </div>
        ) : null}

        {marketErrors.length > 0 ? (
          <div className={styles.marketErrorBox}>
            {marketErrors.slice(0, 3).map((err) => (
              <div key={`${err.market_id}-${err.code}-${err.message}`}>
                [{err.market_id}] {err.code}: {err.message}
              </div>
            ))}
          </div>
        ) : null}

        <div className={styles.marketItems}>
          {marketplace.slice(0, 12).map((item) => {
            const key = `${item.market_id}/${item.skill_id}`;
            return (
              <div key={key} className={styles.marketItemCard}>
                <div className={styles.marketItemMain}>
                  <div className={styles.marketItemName}>{item.name}</div>
                  <div className={styles.marketItemMeta}>
                    {item.market_id} / {item.skill_id}
                  </div>
                  {item.description ? (
                    <div className={styles.marketItemDesc}>{item.description}</div>
                  ) : null}
                </div>
                <Button
                  size="small"
                  loading={installingSkillKey === key}
                  onClick={() => {
                    void handleInstallMarketplaceSkill(
                      item.market_id,
                      item.skill_id,
                    );
                  }}
                >
                  Install
                </Button>
              </div>
            );
          })}
          {marketplace.length === 0 && !marketplaceLoading ? (
            <div className={styles.marketEmpty}>No marketplace items found.</div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>
          <span className={styles.loadingText}>{t("common.loading")}</span>
        </div>
      ) : (
        <div className={styles.skillsGrid}>
          {skills
            .slice()
            .sort((a, b) => {
              if (a.enabled && !b.enabled) return -1;
              if (!a.enabled && b.enabled) return 1;
              return a.name.localeCompare(b.name);
            })
            .map((skill) => (
              <SkillCard
                key={skill.name}
                skill={skill}
                isHover={hoverKey === skill.name}
                onClick={() => handleEdit(skill)}
                onMouseEnter={() => setHoverKey(skill.name)}
                onMouseLeave={() => setHoverKey(null)}
                onToggleEnabled={(e) => handleToggleEnabled(skill, e)}
                onDelete={(e) => handleDelete(skill, e)}
              />
            ))}
        </div>
      )}

      <SkillDrawer
        open={drawerOpen}
        editingSkill={editingSkill}
        form={form}
        onClose={handleDrawerClose}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

export default SkillsPage;
