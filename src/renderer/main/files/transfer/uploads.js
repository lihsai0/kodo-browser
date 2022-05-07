import angular from "angular"

import webModule from '@/app-module/web'

import jobUtil from '@/components/services/job-util'
import DelayDone from '@/components/services/delay-done'
import { TOAST_FACTORY_NAME as Toast } from '@/components/directives/toast-list'
import {
  EMPTY_FOLDER_UPLOADING,
} from '@/const/setting-keys'
import { DIALOG_FACTORY_NAME as Dialog } from '@/components/services/dialog.s'

const TRANSFER_UPLOAD_CONTROLLER_NAME = 'transferUploadsCtrl'

webModule.controller(TRANSFER_UPLOAD_CONTROLLER_NAME, [
  "$scope",
  "$timeout",
  "$translate",
  jobUtil,
  DelayDone,
  Toast,
  Dialog,
  function (
    $scope,
    $timeout,
    $translate,
    jobUtil,
    DelayDone,
    Toast,
    Dialog
  ) {
    const T = $translate.instant;

    angular.extend($scope, {
      triggerEmptyFolder: triggerEmptyFolder,
      showRemoveItem: showRemoveItem,
      clearAllCompleted: clearAllCompleted,
      clearAll: clearAll,
      stopAll: stopAll,
      startAll: startAll,
      checkStartJob: checkStartJob,

      sch: {
        upname: null
      },
      schKeyFn: function (item) {
        return (
          item.options.from.name +
          " " +
          item.status +
          " " +
          jobUtil.getStatusLabel(item.status)
        );
      },
      limitToNum: 100,
      loadMoreUploadItems: loadMoreItems
    });

    function loadMoreItems() {
      const len = $scope.lists.uploadJobList.length;
      if ($scope.limitToNum < len) {
        $scope.limitToNum += Math.min(100, len - $scope.limitToNum);
      }
    }

    function triggerEmptyFolder() {
      $scope.emptyFolderUploading.enabled = !$scope.emptyFolderUploading.enabled;
      localStorage.setItem(EMPTY_FOLDER_UPLOADING, $scope.emptyFolderUploading.enabled);
    }

    function checkStartJob(item, force) {
      if (force) {
        item.start(true);
      } else {
        item.wait();
      }

      // TODO: send IPC to schedule upload jobs
    }

    // TODO: rename to `removeJobConfirm`
    function showRemoveItem(item) {
      if (item.status === "finished") {
        doRemove(item);
      } else {
        const title = T("remove.from.list.title"); //'从列表中移除'
        const message = T("remove.from.list.message"); //'确定移除该上传任务?'
        Dialog.confirm(
          title,
          message,
          (btn) => {
            if (btn) {
              doRemove(item);
            }
          },
          1
        );
      }
    }

    function doRemove(item) {
      // TODO: send IPC to remove upload jobs
    }

    function clearAllCompleted() {
      // TODO: send IPC to cleanup upload jobs
    }

    function clearAll() {
      if (!$scope.lists.uploadJobList ||
        $scope.lists.uploadJobList.length === 0) {
        return;
      }

      const title = T("clear.all.title"); //清空所有
      const message = T("clear.all.upload.message"); //确定清空所有上传任务?
      Dialog.confirm(
        title,
        message,
        (btn) => {
          if (btn) {
            // TODO: send IPC to remove all upload jobs
          }
        },
        1
      );
    }

    let stopFlag = false;

    function stopAll() {
      const arr = $scope.lists.uploadJobList;
      if (arr && arr.length > 0) {
        stopFlag = true;

        Toast.info(T("pause.on")); //'正在暂停...'
        $scope.allActionBtnDisabled = true;

        // TODO: send IPC stop creating and stop all running upload jobs

        Toast.info(T("pause.success"));

        $timeout(function () {
          $scope.allActionBtnDisabled = false;
        }, 100);
      }
    }

    function startAll() {
      const arr = $scope.lists.uploadJobList;
      stopFlag = false;
      //串行
      if (arr && arr.length > 0) {
        $scope.allActionBtnDisabled = true;
        DelayDone.seriesRun(
          arr,
          function (n, fn) {
            if (stopFlag) {
              return;
            }

            if (n && (n.status === "stopped" || n.status === "failed")) {
              n.wait();
            }

            // TODO: send IPC to schedule upload jobs

            fn();
          },
          function doneFn() {
            $scope.allActionBtnDisabled = false;
          }
        );
      }
    }
  }
]);

export default TRANSFER_UPLOAD_CONTROLLER_NAME
