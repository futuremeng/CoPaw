import { Input, Modal, Segmented, Upload } from "antd";
import { useTranslation } from "react-i18next";
import styles from "../index.module.less";
import type { ProjectPendingUpload, ProjectUploadMode } from "../hooks/useProjectUploadController";

const { Dragger } = Upload;

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
      onOk={onUpload}
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
            onChangePendingUploads((prev) => {
              const exists = prev.some(
                (item) => item.relativePath === relativePath && item.file.size === file.size,
              );
              return exists ? prev : [...prev, { file: file as File, relativePath }];
            });
            return false;
          }}
          onRemove={(file) => {
            const relativePath = normalizeRelativePath(file as File);
            onChangePendingUploads((prev) =>
              prev.filter(
                (item) => !(item.relativePath === relativePath && item.file.size === file.size),
              ),
            );
            return true;
          }}
          fileList={pendingUploads.map((item, index) => ({
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
      </div>
    </Modal>
  );
}