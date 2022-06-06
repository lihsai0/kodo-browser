import fs from "fs";
import path from "path";
import { ipcRenderer } from "electron";
import angular from "angular"

import ByteSize from "@common/const/byte-size";
import { UploadAction } from "@common/ipc-actions/upload";

import webModule from '@/app-module/web'

import * as AuthInfo from '@/components/services/authinfo';
import Settings from '@/components/services/settings';
import safeApply from '@/components/services/safe-apply';
import ipcUploadManager from '@/components/services/ipc-upload-manager';

import NgConfig from '@/ng-config'
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
import {Status} from "@common/models/job/types";

const TRANSFER_FRAME_CONTROLLER_NAME = 'transferFrameCtrl'

webModule.controller(TRANSFER_FRAME_CONTROLLER_NAME, [
  "$scope",
  "$translate",
  safeApply,
  NgConfig,
  DownloadMgr,
  Toast,
  function (
    $scope,
    $translate,
    safeApply,
    ngConfig,
    DownloadMgr,
    Toast,
  ) {
    const T = $translate.instant;
    let uploaderTimer;

    angular.extend($scope, {
      transTab: 1,

      transSearch: {
        uploadJob: "",
      },

      lists: {
        uploadJobList: [],
        uploadJobListLimit: 100,
        downloadJobList: [],
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
        up: 0,
        upRunning: 0,
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

    initUploaderIpc();
    DownloadMgr.init($scope);

    $scope.$on('$destroy', () => {
      clearInterval(uploaderTimer);
    });

    // init Uploader IPC
    function initUploaderIpc() {
      ipcRenderer.on("UploaderManager-reply", (_event, message) => {
        safeApply($scope, () => {
          switch (message.action) {
            case UploadAction.UpdateUiData: {
              $scope.lists.uploadJobList = message.data.list;
              $scope.totalStat.up = message.data.total;
              $scope.totalStat.upDone = message.data.finished;
              $scope.totalStat.upFailed = message.data.failed;
              $scope.totalStat.upStopped = message.data.stopped;
              // console.log("lihs debug:", "renderer update ui by", message.data);
              break;
            }
            default: {
              console.warn("renderer received unknown action, message:", message);
            }
          }
        });
      });
      ipcUploadManager.updateConfig({
        resumeUpload: Settings.resumeUpload !== 0,
        maxConcurrency: Settings.maxUploadConcurrency,
        multipartUploadSize: Settings.multipartUploadSize * ByteSize.MB,
        multipartUploadThreshold: Settings.multipartUploadThreshold * ByteSize.MB,
        uploadSpeedLimit: Settings.uploadSpeedLimitEnabled * ByteSize.KB,
        isDebug: Settings.isDebug !== 0,
        persistPath: getProgFilePath(),
      });
      ipcUploadManager.loadPersistJobs({
        clientOptions: {
          accessKey: AuthInfo.get().id,
          secretKey: AuthInfo.get().secret,
          ucUrl: NgConfig.ucUrl || "",
          regions: NgConfig.regions || [],
        },
        uploadOptions: {
          userNatureLanguage: localStorage.getItem("lang") || "zh-CN",
        },
      });
      uploaderTimer = setInterval(() => {
        let query;
        if ($scope.transSearch.uploadJob) {
          if (Object.values(Status).includes($scope.transSearch.uploadJob.trim())) {
            query = {
              status: $scope.transSearch.uploadJob.trim(),
            };
          } else {
            query = {
              name: $scope.transSearch.uploadJob.trim(),
            };
          }
        }
        ipcUploadManager.updateUiData({
          pageNum: 0,
          count: $scope.lists.uploadJobListLimit,
          query: query,
        });
      }, 1000);

      function getProgFilePath() {
        const folder = Global.config_path;
        if (!fs.existsSync(folder)) {
          fs.mkdirSync(folder);
        }

        const username = AuthInfo.get().id || "kodo-browser";
        return path.join(folder, "upprog_" + username + ".json");
      }
    }

    /**
     * upload
     * @param filePaths []  {array<string>}, iter for folder
     * @param bucketInfo {object} {bucket, region, key}
     * @param uploadOptions {object} {isOverwrite, storageClassName}, storageClassName is fetched from server
     */
    function uploadFilesHandler(filePaths, bucketInfo,uploadOptions) {
      Toast.info(T("upload.addtolist.on"));
      ipcUploadManager.addJobs({
        filePathnameList: filePaths,
        destInfo: {
          bucketName: bucketInfo.bucketName,
          key: bucketInfo.key,
        },
        uploadOptions: {
          regionId: bucketInfo.regionId,
          isOverwrite: uploadOptions.isOverwrite,
          storageClassName: uploadOptions.storageClassName,
          storageClasses: bucketInfo.availableStorageClasses,
          userNatureLanguage: localStorage.getItem('lang') || 'zh-CN',
        },
        clientOptions: {
          accessKey: AuthInfo.get().id,
          secretKey: AuthInfo.get().secret,
          ucUrl: ngConfig.ucUrl || "",
          regions: ngConfig.regionId || [],
          backendMode: bucketInfo.qiniuBackendMode,
        },
      });
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

      $scope.totalStat.running = $scope.totalStat.upRunning + c2;
      $scope.totalStat.total = $scope.totalStat.up + $scope.lists.downloadJobList.length;
      $scope.totalStat.downDone = $scope.lists.downloadJobList.length - c2;
      $scope.totalStat.downStopped = cs2;
      $scope.totalStat.downFailed = cf2;
    }
  }
]);

export default TRANSFER_FRAME_CONTROLLER_NAME
