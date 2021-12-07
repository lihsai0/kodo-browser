import angular from "angular"

import webModule from '@/app-module/web'

import jobUtil from '@/components/services/job-util'
import DownloadMgr from '@/components/services/download-manager'
import DelayDone from '@/components/services/delay-done'
import { TOAST_FACTORY_NAME as Toast } from '@/components/directives/toast-list'
import { OVERWRITE_DOWNLOADING } from '@/const/setting-keys'
import { DIALOG_FACTORY_NAME as Dialog} from '@/components/services/dialog.s'

const TRANSFER_DOWNLOADS_CONTROLLER_NAME = 'transferDownloadsCtrl'

webModule.controller(TRANSFER_DOWNLOADS_CONTROLLER_NAME, [
  "$scope",
  "$timeout",
  "$translate",
  jobUtil,
  DownloadMgr,
  DelayDone,
  Toast,
  Dialog,
  function (
    $scope,
    $timeout,
    $translate,
    jobUtil,
    DownloadMgr,
    DelayDone,
    Toast,
    Dialog
  ) {
    var T = $translate.instant;

    angular.extend($scope, {
      triggerOverwriting: triggerOverwriting,
      showRemoveItem: showRemoveItem,
      clearAllCompleted: clearAllCompleted,
      clearAll: clearAll,
      stopAll: stopAll,
      startAll: startAll,
      checkStartJob: checkStartJob,

      sch: {
        downname: null
      },
      schKeyFn: function (item) {
        return (
          item.options.to.name +
          " " +
          item.status +
          " " +
          jobUtil.getStatusLabel(item.status)
        );
      },
      limitToNum: 100,
      loadMoreDownloadItems: loadMoreItems
    });

    function loadMoreItems() {
      var len = $scope.lists.downloadJobList.length;
      if ($scope.limitToNum < len) {
        $scope.limitToNum += Math.min(100, len - $scope.limitToNum);
      }
    }

    function triggerOverwriting() {
      $scope.overwriteDownloading.enabled = !$scope.overwriteDownloading.enabled;
      localStorage.setItem(OVERWRITE_DOWNLOADING, $scope.overwriteDownloading.enabled);
    }

    function checkStartJob(item) {
      item.wait();

      DownloadMgr.trySchedJob();
    }

    function showRemoveItem(item) {
      if (item.status == "finished") {
        doRemove(item);
      } else {
        var title = T("remove.from.list.title"); //'从列表中移除'
        var message = T("remove.from.list.message"); //'确定移除该下载任务?'
        Dialog.confirm(
          title,
          message,
          (btn) => {
            if (btn) {
              if (item.status == "running" ||
                item.status == "waiting" ||
                item.status == "verifying") {
                item.stop();
              }

              doRemove(item);
            }
          },
          1
        );
      }
    }

    function doRemove(item) {
      var jobs = $scope.lists.downloadJobList;
      for (var i = 0; i < jobs.length; i++) {
        if (item === jobs[i]) {
          jobs.splice(i, 1);
          break;
        }
      }

      $timeout(() => {
        DownloadMgr.trySaveProg();
        $scope.calcTotalProg();
      });
    }

    function clearAllCompleted() {
      var jobs = $scope.lists.downloadJobList;
      for (var i = 0; i < jobs.length; i++) {
        if ("finished" == jobs[i].status) {
          jobs.splice(i, 1);
          i--;
        }
      }

      $timeout(() => {
        $scope.calcTotalProg();
      });
    }

    function clearAll() {
      if (!$scope.lists.downloadJobList ||
        $scope.lists.downloadJobList.length == 0) {
        return;
      }

      var title = T("clear.all.title"); //清空所有
      var message = T("clear.all.download.message"); //确定清空所有下载任务?
      Dialog.confirm(
        title,
        message,
        (btn) => {
          if (btn) {
            var jobs = $scope.lists.downloadJobList;
            for (var i = 0; i < jobs.length; i++) {
              var job = jobs[i];
              if (job.status == "running" ||
                job.status == "waiting" ||
                job.status == "verifying") {
                job.stop();
              }

              jobs.splice(i, 1);
              i--;
            }

            $timeout(() => {
              DownloadMgr.trySaveProg();
              $scope.calcTotalProg();
            });
          }
        },
        1
      );
    }

    var stopFlag = false;

    function stopAll() {
      var jobs = $scope.lists.downloadJobList;
      if (jobs && jobs.length > 0) {
        stopFlag = true;

        DownloadMgr.stopCreatingJobs();

        Toast.info(T("pause.on")); //'正在暂停...'
        $scope.allActionBtnDisabled = true;

        angular.forEach(jobs, (job) => {
          if (job.prog.resumable && (
              job.status == "running" ||
              job.status == "waiting" ||
              job.status == "verifying"
            ))
            n.stop();
        });
        Toast.success(T("pause.success")); //'暂停成功'

        $timeout(() => {
          DownloadMgr.trySaveProg();
          $scope.allActionBtnDisabled = false;
        });
      }
    }

    function startAll() {
      stopFlag = false;

      //串行
      var jobs = $scope.lists.downloadJobList;
      if (jobs && jobs.length > 0) {
        $scope.allActionBtnDisabled = true;
        DelayDone.seriesRun(
          jobs,
          (job, fn) => {
            if (stopFlag) return;

            if (job && (job.status == "stopped" || job.status == "failed")) {
              job.wait();
            }

            fn();
          },
          () => {
            DownloadMgr.trySchedJob();
            $scope.allActionBtnDisabled = false;
          }
        );
      }
    }
  }
]);

export default TRANSFER_DOWNLOADS_CONTROLLER_NAME
