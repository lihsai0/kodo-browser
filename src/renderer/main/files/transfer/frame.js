import { ipcRenderer } from "electron";
import angular from "angular"

import webModule from '@/app-module/web'

import * as AuthInfo from '@/components/services/authinfo';

import NgConfig from '@/ng-config'
import UploadMgr from '@/components/services/upload-manager'
import DownloadMgr from '@/components/services/download-manager'
import { TOAST_FACTORY_NAME as Toast } from '@/components/directives/toast-list'
import {
  EMPTY_FOLDER_UPLOADING,
  OVERWRITE_DOWNLOADING,
} from '@/const/setting-keys'
import * as AuditLog from '@/components/services/audit-log'

// import dependent controllers
import './downloads'
import './uploads'

import './frame.css'

const TRANSFER_FRAME_CONTROLLER_NAME = 'transferFrameCtrl'

webModule.controller(TRANSFER_FRAME_CONTROLLER_NAME, [
  "$scope",
  "$translate",
  NgConfig,
  UploadMgr,
  DownloadMgr,
  Toast,
  function (
    $scope,
    $translate,
    ngConfig,
    UploadMgr,
    DownloadMgr,
    Toast,
  ) {
    const T = $translate.instant;

    angular.extend($scope, {
      transTab: 1,

      lists: {
        uploadJobList: [],
        downloadJobList: []
      },
      emptyFolderUploading: {
        enabled: localStorage.getItem(EMPTY_FOLDER_UPLOADING) || true,
      },
      overwriteDownloading: {
        enabled: localStorage.getItem(OVERWRITE_DOWNLOADING) || false,
      },

      totalStat: {
        running: 0,
        total: 0,
        upDone: 0,
        upStopped: 0,
        upFailed: 0,
        downDone: 0,
        downStopped: 0,
        downFailed: 0
      },

      calcTotalProg: calcTotalProg
    });

    // functions in parent scope
    $scope.handlers.uploadFilesHandler = uploadFilesHandler;
    $scope.handlers.downloadFilesHandler = downloadFilesHandler;

    UploadMgr.init($scope);
    DownloadMgr.init($scope);

    ipcRenderer.on("UploaderManager-reply", (_event, message) => {
      switch (message.action) {
        case "updateUiData": {
          console.log("lihs debug:", "renderer update ui by", message.data);
          break;
        }
        default: {
          console.warn("renderer received unknown action, message:", message);
        }
      }
    });

    /**
     * upload
     * @param filePaths []  {array<string>}, iter for folder
     * @param bucketInfo {object} {bucket, region, key}
     * @param uploadOptions {object} {isOverwrite, storageClassName}, storageClassName is fetched from server
     */
    function uploadFilesHandler(filePaths, bucketInfo,uploadOptions) {
      Toast.info(T("upload.addtolist.on"));
      ipcRenderer.send("UploaderManager", {
        action: "addJobs",
        data: {
          filePathnameList: filePaths,
          destInfo: {
            bucketName: bucketInfo.bucketName,
            key: bucketInfo.key,
          },
          uploadOptions: {
            regionId: bucketInfo.regionId,
            isOverwrite: uploadOptions.isOverwrite,
            storageClassName: uploadOptions.storageClassName,
          },
          clientOptions: {
            accessKey: AuthInfo.get().id,
            secretKey: AuthInfo.get().secret,
            ucUrl: ngConfig.ucUrl || "",
            regions: ngConfig.regionId || [],
            backendMode: bucketInfo.backendMode,
            storageClasses: bucketInfo.availableStorageClasses,
          },
        },
      });

      console.log("lihs debug:", "sent ipcRenderer", {
        action: "addJobs",
        data: {
          filePathnameList: filePaths,
          destInfo: {
            bucketName: bucketInfo.bucketName,
            key: bucketInfo.key,
          },
          uploadOptions: {
            regionId: bucketInfo.regionId,
            isOverwrite: uploadOptions.isOverwrite,
            storageClassName: uploadOptions.storageClassName,
          },
          clientOptions: {
            accessKey: AuthInfo.get().id,
            secretKey: AuthInfo.get().secret,
            ucUrl: ngConfig.ucUrl || "",
            regions: ngConfig.regionId || [],
            storageClasses: bucketInfo.availableStorageClasses,
          },
        },
      });

      // old logic
      // UploadMgr.createUploadJobs(filePaths, bucketInfo, uploadOptions, function (isCancelled) {
      //   Toast.info(T("upload.addtolist.success"));
      //
      //   $scope.transTab = 1;
      //   $scope.toggleTransVisible(true);
      //
      //   AuditLog.log(
      //     AuditLog.Action.UploadFilesStart,
      //     {
      //       regionId: bucketInfo.region,
      //       bucket: bucketInfo.bucketName,
      //       to: bucketInfo.key,
      //       from: filePaths,
      //     },
      //   );
      // });
    }

    /**
     * download
     * @param fromRemotePath {array}  item={region, bucket, path, name, domain, size=0, itemType='file'}, create folder if required
     * @param toLocalPath {string}
     */
    function downloadFilesHandler(fromRemotePath, toLocalPath) {
      Toast.info(T("download.addtolist.on"));
      DownloadMgr.createDownloadJobs(fromRemotePath, toLocalPath, function (isCancelled) {
        Toast.info(T("download.addtolist.success"));

        AuditLog.log(
          AuditLog.Action.DownloadFilesStart,
          {
            from: fromRemotePath.map((entry) => {
              return { regionId: entry.region, bucket: entry.bucketName, path: entry.path.toString() };
            }),
            to: toLocalPath,
          },
        );

        $scope.transTab = 2;
        $scope.toggleTransVisible(true);
      });
    }

    function calcTotalProg() {
      let c = 0, c2 = 0, cf = 0, cf2 = 0, cs = 0, cs2 = 0;

      angular.forEach($scope.lists.uploadJobList, function (n) {
        if (n.status === 'running') {
          c++;
        }
        if (n.status === 'waiting') {
          c++;
        }
        if (n.status === 'verifying') {
          c++;
        }
        if (n.status === 'failed') {
          cf++;
        }
        if (n.status === 'stopped') {
          c++;
          cs++;
        }
      });
      angular.forEach($scope.lists.downloadJobList, function (n) {
        if (n.status === 'running') {
          c2++;
        }
        if (n.status === 'waiting') {
          c2++;
        }
        if (n.status === 'failed') {
          cf2++;
        }
        if (n.status === 'stopped') {
          c2++;
          cs2++;
        }
      });

      $scope.totalStat.running = c + c2;
      $scope.totalStat.total = $scope.lists.uploadJobList.length + $scope.lists.downloadJobList.length;
      $scope.totalStat.upDone = $scope.lists.uploadJobList.length - c;
      $scope.totalStat.upStopped = cs;
      $scope.totalStat.upFailed = cf;
      $scope.totalStat.downDone = $scope.lists.downloadJobList.length - c2;
      $scope.totalStat.downStopped = cs2;
      $scope.totalStat.downFailed = cf2;
    }
  }
]);

export default TRANSFER_FRAME_CONTROLLER_NAME
