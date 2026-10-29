// Resource-group deployment. The tool supplies deployerPrincipalId (object ID),
// deployDatabaseAndApp, containerImage, postgresAdministratorPassword (secure),
// keyVaultSecretNames (existing secret names only), and allowedFirewallIps.
// Foundation uses an empty secure password; full deployment reads it from Key Vault.
param environment string
param location string = resourceGroup().location
param deployerPrincipalId string = ''
param deployDatabaseAndApp bool = false
@secure()
param postgresAdministratorPassword string = ''
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
param keyVaultSecretNames array = []
param allowedFirewallIps array = []
param allowAzureServices bool = false
param postgresSku string
param minReplicas int = 0
param maxReplicas int = 1
param targetPort int = 80
param enableHealthProbes bool = false
var suffix = uniqueString(resourceGroup().id)
var tags = { environment: environment, app: 'calendar' }
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: { location: location, suffix: suffix, tags: tags }
}
module foundation 'modules/foundation.bicep' = {
  name: 'foundation'
  params: {
    location: location
    suffix: suffix
    tags: tags
    workspaceId: monitoring.outputs.workspaceId
    deployerPrincipalId: deployerPrincipalId
  }
}
module database 'modules/database.bicep' = if (deployDatabaseAndApp) {
  name: 'database'
  params: {
    location: location
    suffix: suffix
    tags: tags
    sku: postgresSku
    administratorPassword: postgresAdministratorPassword
    allowedFirewallIps: allowedFirewallIps
    allowAzureServices: allowAzureServices
  }
}
module app 'modules/app.bicep' = if (deployDatabaseAndApp) {
  name: 'app'
  params: {
    location: location
    suffix: suffix
    tags: tags
    workspaceId: monitoring.outputs.workspaceId
    workspaceCustomerId: monitoring.outputs.workspaceCustomerId
    registryLoginServer: foundation.outputs.registryLoginServer
    identityId: foundation.outputs.identityId
    vaultUri: foundation.outputs.vaultUri
    containerImage: containerImage
    keyVaultSecretNames: keyVaultSecretNames
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    targetPort: targetPort
    enableHealthProbes: enableHealthProbes
  }
}
