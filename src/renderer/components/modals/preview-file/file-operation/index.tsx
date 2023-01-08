import React, {PropsWithChildren} from "react";

import StorageClass from "@common/models/storage-class";

import {FileItem} from "@renderer/modules/qiniu-client";
import {DomainAdapter} from "@renderer/modules/qiniu-client-hooks";

import {OperationDoneRecallFn} from "../../file/types";
import ChangeStorageClass from "./change-storage-class";
import GenerateLink from "./generate-link";
import {useI18n} from "@renderer/modules/i18n";

export enum FileOperationType {
  None = "none",
  GenerateLink = "generateLink",
  ChangeStorageClass = "changeStorageClass",
}

interface FileOperationProps {
  fileOperationType: FileOperationType,
  regionId: string,
  bucketName: string,
  basePath: string,
  fileItem: FileItem.File,
  canS3Domain: boolean,
  defaultDomain: DomainAdapter | undefined,
  storageClasses: StorageClass[],
  operationPortal: React.FC<PropsWithChildren>,
  onHideOperation: () => void,
  onOperationDone: OperationDoneRecallFn,
}

const FileOperation: React.FC<FileOperationProps> = ({
  fileOperationType,
  regionId,
  bucketName,
  basePath,
  fileItem,
  canS3Domain,
  defaultDomain,
  storageClasses,
  operationPortal,
  onHideOperation,
  onOperationDone,
}) => {
  const {translate} = useI18n();

  switch (fileOperationType) {
    case FileOperationType.GenerateLink:
      if (!fileItem.name) {
        return (
          <div className="p-1 text-center">
            {translate("modals.generateFileLink.emptyFileNameHint")}
          </div>
        );
      }
      return (
        <GenerateLink
          fileItem={fileItem}
          regionId={regionId}
          bucketName={bucketName}
          canS3Domain={canS3Domain}
          defaultDomain={defaultDomain}
          submitButtonPortal={operationPortal}
        />
      );
    case FileOperationType.ChangeStorageClass:
      return (
        <ChangeStorageClass
          regionId={regionId}
          bucketName={bucketName}
          basePath={basePath}
          fileItem={fileItem}
          storageClasses={storageClasses}
          submitButtonPortal={operationPortal}
          onChangedFileStorageClass={(...args) => {
            onHideOperation();
            onOperationDone(...args);
          }}
        />
      );
  }
  return null;
};

export default FileOperation
