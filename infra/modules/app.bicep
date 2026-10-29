param location string
param suffix string
param tags object
param workspaceId string
param workspaceCustomerId string
param registryLoginServer string
param identityId string
param vaultUri string
param containerImage string
param keyVaultSecretNames array
param minReplicas int
param maxReplicas int
param targetPort int
param enableHealthProbes bool
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: last(split(workspaceId, '/'))
}
var mappings = [
  { secret: 'calendar-connection-string', env: 'ConnectionStrings__Calendar' }
  { secret: 'google-client-id', env: 'Auth__Google__ClientId' }
  { secret: 'google-client-secret', env: 'Auth__Google__ClientSecret' }
]
var fixedEnv = [for mapping in filter(mappings, m => contains(keyVaultSecretNames, m.secret)): { name: mapping.env, secretRef: mapping.secret }]
var emailEnv = [for secret in filter(keyVaultSecretNames, s => startsWith(s, 'allowed-email-')): { name: 'Auth__AllowedEmails__${substring(secret, 14)}', secretRef: secret }]
resource environment 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: 'cae-calendar-${suffix}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: workspaceCustomerId, sharedKey: workspace.listKeys().primarySharedKey }
    }
    workloadProfiles: [ { name: 'Consumption', workloadProfileType: 'Consumption' } ]
  }
}
resource app 'Microsoft.App/containerApps@2026-07-01' = {
  name: 'ca-calendar-${suffix}'
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identityId}': {} } }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: targetPort, allowInsecure: false, transport: 'auto' }
      registries: [ { server: registryLoginServer, identity: identityId } ]
      secrets: [for secret in keyVaultSecretNames: { name: secret, keyVaultUrl: '${vaultUri}secrets/${secret}', identity: identityId }]
    }
    template: {
      containers: [ {
        name: 'calendar'
        image: containerImage
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: concat(fixedEnv, emailEnv)
        probes: enableHealthProbes ? [
          { type: 'Startup', httpGet: { path: '/api/health', port: targetPort }, initialDelaySeconds: 1, periodSeconds: 5, failureThreshold: 60 }
          { type: 'Liveness', httpGet: { path: '/api/health', port: targetPort }, periodSeconds: 10, failureThreshold: 3 }
          { type: 'Readiness', httpGet: { path: '/api/health', port: targetPort }, periodSeconds: 5, failureThreshold: 3 }
        ] : []
      } ]
      scale: { minReplicas: minReplicas, maxReplicas: maxReplicas }
    }
  }
}
