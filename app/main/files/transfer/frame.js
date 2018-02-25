angular.module("web").controller("transferFrameCtrl", [
  "$scope",
  "$translate",
  "osUploadManager",
  "osDownloadManager",
  "Toast",
  "safeApply",
  function (
    $scope,
    $translate,
    osUploadManager,
    osDownloadManager,
    Toast,
    safeApply
  ) {
    var T = $translate.instant;

    angular.extend($scope, {
      transTab: 1,

      lists: {
        uploadJobList: [],
        downloadJobList: []
      },

      totalProg: {
        loaded: 0,
        total: 0
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

    //functions in parent scope
    $scope.handlers.uploadFilesHandler = uploadFilesHandler;
    $scope.handlers.downloadFilesHandler = downloadFilesHandler;

    osUploadManager.init($scope);
    osDownloadManager.init($scope);

    /**
     * upload
     * @param filePaths []  {array<string>}, iter for folder
     * @param bucketInfo {object} {bucket, region, key}
     */
    function uploadFilesHandler(filePaths, bucketInfo) {
      Toast.info(T("upload.addtolist.on"));

      osUploadManager.createUploadJobs(filePaths, bucketInfo, function (isCancelled) {
        Toast.info(T("upload.addtolist.success"));

        $scope.transTab = 1;
        $scope.toggleTransVisible(true);
      });
    }

    /**
     * download
     * @param fromOssPath {array}  item={region, bucket, path, name, size=0, isFolder=false}, create folder if required
     * @param toLocalPath {string}
     */
    function downloadFilesHandler(fromOssPath, toLocalPath) {
      Toast.info(T("download.addtolist.on"));

      osDownloadManager.createDownloadJobs(fromOssPath, toLocalPath, function (isCancelled) {
        Toast.info(T("download.addtolist.success"));

        $scope.transTab = 2;
        $scope.toggleTransVisible(true);
      });
    }

    function calcTotalProg() {
      var c = 0,
        c2 = 0,
        cf = 0,
        cf2 = 0,
        cs = 0,
        cs2 = 0;
      angular.forEach($scope.lists.uploadJobList, function (n) {
        if (n.status == "running") {
          c++;
        }
        if (n.status == "waiting") {
          c++;
        }
        if (n.status == "verifying") {
          c++;
        }
        if (n.status == "failed") {
          cf++;
        }
        if (n.status == "stopped") {
          c++;
          cs++;
        }
      });
      angular.forEach($scope.lists.downloadJobList, function (n) {
        if (n.status == "running") {
          c2++;
        }
        if (n.status == "waiting") {
          c2++;
        }
        if (n.status == "failed") {
          cf2++;
        }
        if (n.status == "stopped") {
          c2++;
          cs2++;
        }
      });

      $scope.totalStat.running = c + c2;
      $scope.totalStat.upDone = $scope.lists.uploadJobList.length - c;
      $scope.totalStat.upStopped = cs;
      $scope.totalStat.upFailed = cf;
      $scope.totalStat.downDone = $scope.lists.downloadJobList.length - c2;
      $scope.totalStat.downStopped = cs2;
      $scope.totalStat.downFailed = cf2;

      $scope.totalStat.total =
        $scope.lists.uploadJobList.length + $scope.lists.downloadJobList.length;
    }
  }
]);