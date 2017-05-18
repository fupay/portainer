angular.module('templates', [])
.controller('TemplatesController', ['$scope', '$q', '$state', '$stateParams', '$anchorScroll', 'Config', 'ContainerService', 'ContainerHelper', 'ImageService', 'NetworkService', 'TemplateService', 'TemplateHelper', 'VolumeService', 'Notifications', 'Pagination', 'ResourceControlService', 'Authentication',
function ($scope, $q, $state, $stateParams, $anchorScroll, Config, ContainerService, ContainerHelper, ImageService, NetworkService, TemplateService, TemplateHelper, VolumeService, Notifications, Pagination, ResourceControlService, Authentication) {
  $scope.state = {
    selectedTemplate: null,
    showAdvancedOptions: false,
    hideDescriptions: $stateParams.hide_descriptions,
    pagination_count: Pagination.getPaginationCount('templates')
  };
  $scope.formValues = {
    Ownership: $scope.applicationState.application.authentication ? 'private' : '',
    network: '',
    name: ''
  };

  $scope.changePaginationCount = function() {
    Pagination.setPaginationCount('templates', $scope.state.pagination_count);
  };

  $scope.addVolume = function () {
    $scope.state.selectedTemplate.Volumes.push({ containerPath: '', name: '', readOnly: false, type: 'auto' });
  };

  $scope.removeVolume = function(index) {
    $scope.state.selectedTemplate.Volumes.splice(index, 1);
  };

  $scope.addPortBinding = function() {
    $scope.state.selectedTemplate.Ports.push({ hostPort: '', containerPort: '', protocol: 'tcp' });
  };

  $scope.removePortBinding = function(index) {
    $scope.state.selectedTemplate.Ports.splice(index, 1);
  };

  $scope.createTemplate = function() {
    $('#createContainerSpinner').show();
    var template = $scope.state.selectedTemplate;
    var templateConfiguration = createTemplateConfiguration(template);
    var generatedVolumeCount = TemplateHelper.determineRequiredGeneratedVolumeCount(template.Volumes);
    VolumeService.createXAutoGeneratedLocalVolumes(generatedVolumeCount)
    .then(function success(data) {
      var volumeResourceControlQueries = [];
      if ($scope.formValues.Ownership === 'private') {
        angular.forEach(data, function (volume) {
          volumeResourceControlQueries.push(ResourceControlService.setVolumeResourceControl(Authentication.getUserDetails().ID, volume.Name));
        });
      }
      TemplateService.updateContainerConfigurationWithVolumes(templateConfiguration, template, data);
      return $q.all(volumeResourceControlQueries)
      .then(function success() {
        return ImageService.pullImage(template.Image, template.Registry);
      });
    })
    .then(function success(data) {
      return ContainerService.createAndStartContainer(templateConfiguration);
    })
    .then(function success(data) {
      Notifications.success('Container started', data.Id);
      if ($scope.formValues.Ownership === 'private') {
        ResourceControlService.setContainerResourceControl(Authentication.getUserDetails().ID, data.Id)
        .then(function success(data) {
          $state.go('containers', {}, {reload: true});
        });
      } else {
        $state.go('containers', {}, {reload: true});
      }
    })
    .catch(function error(err) {
      Notifications.error('Failure', err, err.msg);
    })
    .finally(function final() {
      $('#createContainerSpinner').hide();
    });
  };

  $scope.selectTemplate = function(index, pos) {
    if ($scope.toggle) {
      $scope.toggleSidebar();
    }

    if ($scope.state.selectedTemplate && $scope.state.selectedTemplate.index !== index) {
      var currentTemplateIndex = $scope.state.selectedTemplate.index;
      $('#template_' + currentTemplateIndex).toggleClass('tpl-container--selected');
    }
    $('#template_' + index).toggleClass('tpl-container--selected');

    var template = $scope.templates[pos];
    if (template === $scope.state.selectedTemplate) {
      unselectTemplate();
    } else {
      selectTemplate(index, pos);
    }
  };

  function unselectTemplate() {
    $scope.state.selectedTemplate = null;
  }

  function selectTemplate(index, pos) {
    var selectedTemplate = $scope.templates[pos];
    $scope.state.selectedTemplate = selectedTemplate;

    var reorderedTemplates = _.filter($scope.templates, function(o) {
      return o.index !== index;
    });
    reorderedTemplates = _.orderBy(reorderedTemplates, 'index', 'asc');
    reorderedTemplates = [selectedTemplate].concat(reorderedTemplates);
    $scope.templates = reorderedTemplates;

    if (selectedTemplate.Network) {
      $scope.formValues.network = _.find($scope.availableNetworks, function(o) { return o.Name === selectedTemplate.Network; });
    } else {
      $scope.formValues.network = _.find($scope.availableNetworks, function(o) { return o.Name === 'bridge'; });
    }

    $('#template-widget').animate({ scrollTop:0 }, 'fast');
    $anchorScroll('view-top');
  }

  function createTemplateConfiguration(template) {
    var network = $scope.formValues.network;
    var name = $scope.formValues.name;
    var containerMapping = determineContainerMapping(network);
    return TemplateService.createTemplateConfiguration(template, name, network, containerMapping);
  }

  function determineContainerMapping(network) {
    var endpointProvider = $scope.applicationState.endpoint.mode.provider;
    var containerMapping = 'BY_CONTAINER_IP';
    if (endpointProvider === 'DOCKER_SWARM' && network.Scope === 'global') {
      containerMapping = 'BY_SWARM_CONTAINER_NAME';
    } else if (network.Name !== 'bridge') {
      containerMapping = 'BY_CONTAINER_NAME';
    }
    return containerMapping;
  }

  function filterNetworksBasedOnProvider(networks) {
    var endpointProvider = $scope.applicationState.endpoint.mode.provider;
    if (endpointProvider === 'DOCKER_SWARM' || endpointProvider === 'DOCKER_SWARM_MODE') {
      if (endpointProvider === 'DOCKER_SWARM') {
        networks = NetworkService.filterGlobalNetworks(networks);
      } else {
        networks = NetworkService.filterSwarmModeAttachableNetworks(networks);
      }
      $scope.globalNetworkCount = networks.length;
      NetworkService.addPredefinedLocalNetworks(networks);
    }
    return networks;
  }

  function initTemplates() {
    var templatesKey = $stateParams.key;
    Config.$promise.then(function (c) {
      $q.all({
        templates: TemplateService.getTemplates(templatesKey),
        containers: ContainerService.getContainers(0, c.hiddenLabels),
        networks: NetworkService.getNetworks(),
        volumes: VolumeService.getVolumes()
      })
      .then(function success(data) {
        $scope.templates = data.templates;
        $scope.runningContainers = data.containers;
        $scope.availableNetworks = filterNetworksBasedOnProvider(data.networks);
        $scope.availableVolumes = data.volumes.Volumes;
      })
      .catch(function error(err) {
        $scope.templates = [];
        Notifications.error('Failure', err, 'An error occured during apps initialization.');
      })
      .finally(function final(){
        $('#loadTemplatesSpinner').hide();
      });
    });
  }

  initTemplates();
}]);
