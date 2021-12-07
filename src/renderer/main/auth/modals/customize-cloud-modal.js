import angular from 'angular'

import webModule from '@/app-module/web'

import NgConfig from '@/ng-config'
import NgQiniuClient from '@/components/services/ng-qiniu-client'

const CUSTOMIZE_CLOUD_MODAL_CONTROLLER_NAME = 'customizeCloudModalCtrl'

webModule
  .controller(CUSTOMIZE_CLOUD_MODAL_CONTROLLER_NAME, [
    '$scope',
    '$translate',
    '$uibModalInstance',
    '$timeout',
    NgConfig,
    NgQiniuClient,
    function ($scope, $translate, $modalInstance, $timeout, Config, QiniuClient) {
      const T = $translate.instant;

      let config = { ucUrl: '', regions: [{}] };
      if (Config.exists()) {
        try {
          config = Config.load(false);
        } catch (e) {
          // do nothing;
        }
      }
      if (config.regions && config.regions.length > 0) {
        config.regions.forEach((region) => {
          if (region.s3Urls && region.s3Urls.length > 0) {
            region.endpoint = region.s3Urls[0];
          }
        });
      } else {
        config.regions = [];
      }

      angular.extend($scope, {
        editRegions: editRegions,
        queryAvailable: false,
        ucUrl: config.ucUrl,
        regions: config.regions,
        addRegion: addRegion,
        removeRegion: removeRegion,
        onSubmit: onSubmit,
        cancel: cancel,
        onUcUrlUpdate: onUcUrlUpdate,
      });
      normalizeRegions();
      onUcUrlUpdate();

      function editRegions() {
        return $scope.regions && $scope.regions.length || !$scope.queryAvailable;
      }

      function onUcUrlUpdate() {
        if (!$scope.ucUrl) {
          $timeout(() => {
            $scope.queryAvailable = false;
            normalizeRegions();
          });
          return;
        }
        const ucUrl = $scope.ucUrl;
        QiniuClient.isQueryRegionAPIAvaiable($scope.ucUrl).then((result) => {
          if (ucUrl === $scope.ucUrl) {
            $timeout(() => {
              $scope.queryAvailable = result;
              normalizeRegions();
            });
          }
        }).catch((err) => {
          if (ucUrl === $scope.ucUrl) {
            $timeout(() => {
              $scope.queryAvailable = false;
              normalizeRegions();
            });
          }
        });
      }

      function normalizeRegions() {
        if (($scope.regions === null || $scope.regions.length === 0) && !$scope.queryAvailable) {
          $scope.regions = [{}];
        }
      }

      function addRegion() {
        if ($scope.regions === null) {
          $scope.regions = [];
        }
        $scope.regions.push({});
      }

      function removeRegion(index) {
        if ($scope.regions === null) {
          $scope.regions = [];
        }
        $scope.regions.splice(index, 1);
      }

      function onSubmit(form) {
        if (!form.$valid) return false;

        let ucUrl = $scope.ucUrl;
        let regions = null;
        if (editRegions()) {
          regions = angular.copy($scope.regions);
          regions.forEach((region) => {
            if (region.endpoint) {
              region.s3Urls = [region.endpoint];
            }
          });
        }
        Config.save(ucUrl, regions);
        cancel();
      }

      function cancel() {
        $modalInstance.dismiss('close');
      }
    }
  ]);

export default CUSTOMIZE_CLOUD_MODAL_CONTROLLER_NAME
