import { Input, Modal, Upload } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";

const { Dragger } = Upload;

interface ProjectUploadModalProps {
  open: boolean;
  uploadingFiles: boolean;
  pendingUploads: File[];
  uploadTargetDir: string;
  uploadHint?: string;
  onChangeUploadTargetDir: (value: string) => void;
  onChangePendingUploads: (updater: (prev: File[]) => File[]) => void;
  onUpload: () => void;
  onCancel: () => void;
}

export default function ProjectUploadModal({
  open,
  uploadingFiles,
  pendingUploads,
  uploadTargetDir,
  uploadHint,
  onChangeUploadTargetDir,
  onChangePendingUploads,
  onUpload,
  onCancel,
}: ProjectUploadModalProps) {
  const { t } = useTranslation();

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
          placeholder={t("projects.upload.targetDir", "Target directory (default: original)")}
        />
        <Dragger
          className={styles.uploadDragger}
          multiple
          beforeUpload={(file) => {
            onChangePendingUploads((prev) => {
              const exists = prev.some((item) => item.name === file.name && item.size === file.size);
              return exists ? prev : [...prev, file as File];
            });
            return false;
          }}
          onRemove={(file) => {
            onChangePendingUploads((prev) =>
              prev.filter((item) => !(item.name === file.name && item.size === file.size)),
            );
            return true;
          }}
          fileList={pendingUploads.map((file, index) => ({
            uid: `${file.name}-${file.size}-${index}`,
            name: file.name,
            status: "done" as const,
            size: file.size,
            type: file.type,
          }))}
        >
          <p>{t("projects.upload.dragHint", "Drag files here or click to select")}</p>
        </Dragger>
      </div>
    </Modal>
  );
}