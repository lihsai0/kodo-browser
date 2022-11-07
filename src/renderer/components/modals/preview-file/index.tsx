import React, {useEffect, useMemo, useState} from "react";
import {Button, Modal, ModalProps} from "react-bootstrap";
import {Domain} from "kodo-s3-adapter-sdk/dist/adapter";

import {byteSizeFormat} from "@common/const/byte-size";
import {ADDR_KODO_PROTOCOL} from "@renderer/const/kodo-nav";
import StorageClass from "@common/models/storage-class";

import usePortal from "@renderer/modules/hooks/use-portal";
import {FileItem} from "@renderer/modules/qiniu-client";

import {OperationDoneRecallFn} from "../file/types";
import FileArchived from "./precheck/file-archived";
import FileContent from "./file-content";
import FileOperation, {FileOperationType} from "./file-operation";
import {useI18n} from "@renderer/modules/i18n";

interface PreviewFileProps {
  regionId: string,
  bucketName: string,
  basePath: string,
  fileItem: FileItem.File | null,
  domain?: Domain,
  storageClasses: StorageClass[],
  onClickDownload: (fileItem: FileItem.File) => void,
  onOperationDone: OperationDoneRecallFn,
}

const PreviewFile: React.FC<ModalProps & PreviewFileProps> = (props) => {
  const {
    regionId,
    bucketName,
    basePath,
    fileItem,
    domain,
    storageClasses,
    onClickDownload,
    onOperationDone,
    ...modalProps
  } = props;

  const {translate} = useI18n();

  const {
    memoRegionId,
    memoBucketName,
    memoBasePath,
    memoFileItem,
    memoDomain,
    memoStorageClasses,
  } = useMemo(() => ({
    memoRegionId: regionId,
    memoBucketName: bucketName,
    memoBasePath: basePath,
    memoFileItem: fileItem,
    memoDomain: domain,
    memoStorageClasses: storageClasses,
  }), [modalProps.show]);

  const {
    ref: contentPortalRef,
    portal: contentPortal,
  } = usePortal();

  const {
    ref: operationPortalRef,
    portal: operationPortal,
  } = usePortal();

  const [fileOperation, setFileOperation] = useState<FileOperationType>(FileOperationType.None);

  useEffect(() => {
    if (modalProps.show) {

    } else {
      setFileOperation(FileOperationType.None);
    }
  }, [modalProps.show]);

  return (
    <Modal {...modalProps}>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-eye me-1"/>
          {translate("modals.preview.title")}
          {
            memoFileItem
              ? <small>
                ({byteSizeFormat(memoFileItem.size)})
              </small>
              : null
          }
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-0">
        {
          !memoFileItem
            ? translate("common.noOperationalObject")
            : <>
              <div className="text-bg-info bg-opacity-25 p-1">
                {ADDR_KODO_PROTOCOL}{memoFileItem.bucket}/{memoFileItem.path.toString()}
              </div>
              {
                fileOperation === FileOperationType.None
                  ? <FileArchived
                    regionId={memoRegionId}
                    bucketName={memoBucketName}
                    filePath={memoFileItem.path.toString()}
                  >
                    <FileContent
                      regionId={memoRegionId}
                      bucketName={memoBucketName}
                      fileItem={memoFileItem}
                      domain={memoDomain}
                      portal={contentPortal}
                    />
                  </FileArchived>
                  :<FileOperation
                    fileOperationType= {fileOperation}
                    regionId= {memoRegionId}
                    bucketName= {memoBucketName}
                    basePath= {memoBasePath}
                    fileItem= {memoFileItem}
                    defaultDomain= {memoDomain}
                    storageClasses= {memoStorageClasses}
                    operationPortal={operationPortal}
                    onHideOperation={() => setFileOperation(FileOperationType.None)}
                    onOperationDone={onOperationDone}
                  />
              }
            </>
        }
      </Modal.Body>
      <Modal.Footer className="justify-content-between">
        <div>
          <Button
            size="sm"
            className="me-1"
            variant="outline-solid-gray-300"
            onClick={() => fileItem && onClickDownload(fileItem)}
          >
            <i className="bi bi-cloud-download me-1"/>
            {translate("common.download")}
          </Button>
          <Button
            size="sm"
            className="me-1"
            variant="outline-solid-gray-300"
            onClick={() => setFileOperation(FileOperationType.GenerateLink)}
          >
            <i className="bi bi-link-45deg me-1"/>
            {translate("common.extraLink")}
          </Button>
          <Button
            size="sm"
            className="me-1"
            variant="outline-solid-gray-300"
            onClick={() => setFileOperation(FileOperationType.ChangeStorageClass)}
          >
            <i className="fa fa-exchange me-1"/>
            {translate("common.changeStorageClass")}
          </Button>
        </div>
        <div hidden={fileOperation !== FileOperationType.None} ref={contentPortalRef}/>
        <div hidden={fileOperation === FileOperationType.None}>
          <span ref={operationPortalRef}></span>
          <Button
            size="sm"
            variant="secondary"
            className="ms-1"
            onClick={() => setFileOperation(FileOperationType.None)}
          >
            <i className="bi bi-box-arrow-left me-1"/>
            {translate("modals.preview.back")}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default PreviewFile;
