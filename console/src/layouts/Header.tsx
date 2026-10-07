import { Layout, Space, Spin, Tooltip, Dropdown } from "antd";
import type { MenuProps } from "antd";
import LanguageSwitcher from "../components/LanguageSwitcher/index";
import ThemeToggleButton from "../components/ThemeToggleButton";
import CodingModeToggle from "../components/CodingModeToggle";
import { useTranslation } from "react-i18next";
import { Button, Modal } from "@agentscope-ai/design";
import styles from "./index.module.less";
import api from "../api";
import {
  GITHUB_URL,
  getDocsUrl,
  getFeatureDemosUrl,
  getFaqUrl,
  getReleaseNotesUrl,
  UPDATE_MD,
} from "./constants";
import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CopyOutlined,
  CheckOutlined,
  TagOutlined,
  GithubOutlined,
  FileTextOutlined,
  ReadOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  DownOutlined,
} from "@ant-design/icons";

const { Header: AntHeader } = Layout;

// ── Code block with copy button ───────────────────────────────────────────
function UpdateCodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className={styles.codeBlock}>
      <code className={styles.codeBlockInner}>{code}</code>
      <button
        className={`${styles.copyBtn} ${
          copied ? styles.copyBtnCopied : styles.copyBtnDefault
        }`}
        onClick={handleCopy}
        title="Copy"
      >
        {copied ? <CheckOutlined /> : <CopyOutlined />}
      </button>
    </div>
  );
}

export default function Header() {
  const { t, i18n } = useTranslation();
  const [version, setVersion] = useState<string>("");
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateMarkdown, setUpdateMarkdown] = useState<string>("");

  useEffect(() => {
    api
      .getVersion()
      .then((res) => setVersion(res?.version ?? ""))
      .catch(() => {});
  }, []);

  const handleOpenUpdateModal = () => {
    const lang = i18n.language?.startsWith("zh")
      ? "zh"
      : i18n.language?.startsWith("ru")
      ? "ru"
      : "en";
    setUpdateMarkdown(UPDATE_MD[lang] ?? UPDATE_MD.en);
    setUpdateModalOpen(true);
  };

  const handleNavClick = (url: string) => {
    if (url) {
      const pywebview = (window as any).pywebview;
      if (pywebview?.api) {
        pywebview.api.open_external_link(url);
      } else {
        window.open(url, "_blank");
      }
    }
  };

  return (
    <>
      <AntHeader className={styles.header}>
        <div className={styles.logoWrapper}>
          <img
            src="/copaw-icon.svg"
            alt="CoPaw"
            width={24}
            height={24}
            className={styles.logoImg}
          />
          <span className={styles.brandText}>CoPaw</span>
          <div className={styles.logoDivider} />
          {version && (
            <span
              className={`${styles.versionBadge} ${styles.versionBadgeClickable}`}
              onClick={handleOpenUpdateModal}
            >
              v{version}
            </span>
          )}
        </div>
        <Space size="middle">
          <Dropdown
            menu={{
              items: [
                {
                  key: "tutorial",
                  icon: <ReadOutlined />,
                  label: t("header.tutorial"),
                  onClick: () => handleNavClick(getDocsUrl(i18n.language)),
                },
                {
                  key: "featureDemos",
                  icon: <PlayCircleOutlined />,
                  label: t("header.featureDemos"),
                  onClick: () =>
                    handleNavClick(getFeatureDemosUrl(i18n.language)),
                },
                {
                  key: "changelog",
                  icon: <FileTextOutlined />,
                  label: t("header.changelog"),
                  onClick: () =>
                    handleNavClick(getReleaseNotesUrl(i18n.language)),
                },
                {
                  key: "faq",
                  icon: <QuestionCircleOutlined />,
                  label: t("header.faq"),
                  onClick: () => handleNavClick(getFaqUrl(i18n.language)),
                },
              ] as MenuProps["items"],
            }}
          >
            <Button type="text">
              {t("header.resources")} <DownOutlined />
            </Button>
          </Dropdown>
          <Tooltip title={t("header.github")}>
            <Button
              type="text"
              icon={<GithubOutlined />}
              onClick={() => handleNavClick(GITHUB_URL)}
            >
              {t("header.github")}
            </Button>
          </Tooltip>
          <div className={styles.headerDivider} />
          <CodingModeToggle />
          <div className={styles.headerDivider} />
          <LanguageSwitcher />
          <ThemeToggleButton />
        </Space>
      </AntHeader>

      <Modal
        title={null}
        open={updateModalOpen}
        onCancel={() => setUpdateModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setUpdateModalOpen(false)}>
            {t("common.close")}
          </Button>,
          <Button
            key="releases"
            type="primary"
            className={styles.updateViewReleasesBtn}
            onClick={() => handleNavClick(getReleaseNotesUrl(i18n.language))}
          >
            {t("sidebar.updateModal.viewReleases")}
          </Button>,
        ]}
        width={960}
        className={styles.updateModal}
      >
        {/* Banner area */}
        <div className={styles.updateModalBanner}>
          <div className={styles.updateModalBannerLeft}>
            <span className={styles.updateModalVersionTag}>
              <TagOutlined />
              Version {version}
            </span>
            <div className={styles.updateModalBannerTitle}>
              {t("sidebar.updateModal.title", { version })}
            </div>
          </div>
        </div>

        {/* Markdown content */}
        <div className={styles.updateModalBody}>
          {updateMarkdown ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a({ href, children, className, title }: any) {
                  return (
                    <a
                      href={href}
                      className={className}
                      title={title}
                      onClick={(e) => {
                        e.preventDefault();
                        if (href) handleNavClick(href);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      {children}
                    </a>
                  );
                },
                code({ node, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || "");
                  const isBlock =
                    node?.position?.start?.line !== node?.position?.end?.line ||
                    match;
                  return isBlock ? (
                    <UpdateCodeBlock
                      code={String(children).replace(/\n$/, "")}
                    />
                  ) : (
                    <code className={styles.codeInline} {...props}>
                      {children}
                    </code>
                  );
                },
              }}
            >
              {updateMarkdown}
            </ReactMarkdown>
          ) : (
            <div className={styles.updateModalSpinWrapper}>
              <Spin />
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
