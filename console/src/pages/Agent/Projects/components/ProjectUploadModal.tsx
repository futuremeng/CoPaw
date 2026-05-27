import { Input, Modal, Segmented, Upload } from "antd";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import styles from "../index.module.less";
import type { ProjectPendingUpload, ProjectUploadMode } from "../hooks/useProjectUploadController";

const { Dragger } = Upload;
const PREVIEW_UPLOAD_LIMIT = 200;

interface ProjectUploadModalProps {
  open: boolean;
  uploadingFiles: boolean;
  pendingUploads: ProjectPendingUpload[];
  uploadTargetDir: string;
  uploadMode: ProjectUploadMode;
  uploadHint?: string;
  onChangeUploadTargetDir: (value: string) => void;
  onChangePendingUploads: (updater: (prev: ProjectPendingUpload[]) => ProjectPendingUpload[]) => void;
  onChangeUploadMode: (mode: ProjectUploadMode) => void;
  onUpload: () => void;
  onCancel: () => void;
}

export default function ProjectUploadModal({
  open,
  uploadingFiles,
  pendingUploads,
  uploadTargetDir,
  uploadMode,
  uploadHint,
  onChangeUploadTargetDir,
  onChangePendingUploads,
  onChangeUploadMode,
  onUpload,
  onCancel,
}: ProjectUploadModalProps) {
  const { t } = useTranslation();
  const stagedUploadsRef = useRef<ProjectPendingUpload[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  const flushStagedUploads = () => {
    if (stagedUploadsRef.current.length === 0) {
      return;
    }
    const staged = stagedUploadsRef.current;
    stagedUploadsRef.current = [];

    onChangePendingUploads((prev) => {
      const dedup = new Map<string, ProjectPendingUpload>();
      for (const item of prev) {
        dedup.set(`${item.relativePath}::${item.file.size}::${item.file.lastModified}`, item);
      }
      for (const item of staged) {
        dedup.set(`${item.relativePath}::${item.file.size}::${item.file.lastModified}`, item);
      }
      return Array.from(dedup.values());
    });
  };

  const scheduleFlushStagedUploads = () => {
    if (flushTimerRef.current !== null) {
      return;
    }
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushStagedUploads();
    }, 0);
  };

  const previewUploads = useMemo(
    () => pendingUploads.slice(0, PREVIEW_UPLOAD_LIMIT),
    [pendingUploads],
  );

  useEffect(() => {
    if (!open) {
      stagedUploadsRef.current = [];
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
    };
  }, []);

  const normalizeRelativePath = (file: File): string => {
    const uploadFile = file as File & { webkitRelativePath?: string };
    const raw = typeof uploadFile.webkitRelativePath === "string" ? uploadFile.webkitRelativePath.trim() : "";
    if (!raw) {
      return file.name;
    }
    return raw
      .replace(/^\/+/, "")
      .split("/")
      .filter((segment) => segment && segment !== ".")
      .join("/");
  };

  return (
    <Modal
      title={t("projects.upload.title", "Upload Project Files")}
      open={open}
      width={760}
      wrapClassName={styles.uploadModal}
      styles={{
        body: {
          maxHeight: "min(72vh, 640px)",
          overflow: "hidden",
        },
      }}
      confirmLoading={uploadingFiles}
      onOk={() => {
        flushStagedUploads();
        window.setTimeout(() => {
          onUpload();
        }, 0);
      }}
      onCancel={onCancel}
      okButtonProps={{ disabled: pendingUploads.length === 0 }}
      okText={t("projects.upload.confirm", "Upload")}
    >
      <div className={styles.uploadModalBody}>
        {uploadHint ? <div className={styles.itemMeta}>{uploadHint}</div> : null}
        <Input
          value={uploadTargetDir}
          onChange={(event) => onChangeUploadTargetDir(event.target.value)}
          placeholder={t("projects.upload.targetDir", "Target directory (default: project root)")}
        />
        <Segmented
          block
          options={[
            {
              label: t("projects.upload.mode.files", "文件模式"),
              value: "files",
            },
            {
              label: t("projects.upload.mode.folder", "文件夹模式"),
              value: "folder",
            },
          ]}
          value={uploadMode}
          onChange={(value) => onChangeUploadMode(value as ProjectUploadMode)}
        />
        <Dragger
          className={styles.uploadDragger}
          multiple
          directory={uploadMode === "folder"}
          beforeUpload={(file) => {
            const relativePath = normalizeRelativePath(file as File);
            stagedUploadsRef.current.push({
              file: file as File,
              relativePath,
            });
            scheduleFlushStagedUploads();
            return false;
          }}
          onRemove={(file) => {
            const relativePath = normalizeRelativePath(file as File);
            stagedUploadsRef.current = stagedUploadsRef.current.filter(
              (item) => !(item.relativePath === relativePath && item.file.size === file.size),
            );
            onChangePendingUploads((prev) =>
              prev.filter(
                (item) => !(item.relativePath === relativePath && item.file.size === file.size),
              ),
            );
            return true;
          }}
          fileList={previewUploads.map((item, index) => ({
            uid: `${item.relativePath}-${item.file.size}-${index}`,
            name: item.relativePath,
            status: "done" as const,
            size: item.file.size,
            type: item.file.type,
          }))}
        >
          <p>
            {uploadMode === "folder"
              ? t("projects.upload.folderDragHint", "选择文件夹后将按目录结构上传全部文件")
              : t("projects.upload.dragHint", "Drag files here or click to select")}
          </p>
        </Dragger>
        {pendingUploads.length > PREVIEW_UPLOAD_LIMIT ? (
          <div className={styles.itemMeta}>
            {t("projects.upload.previewLimitNotice", "Showing first {{count}} files ({{total}} selected)", {
              count: PREVIEW_UPLOAD_LIMIT,
              total: pendingUploads.length,
            })}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}