param location string
param suffix string
param tags object
param workspaceId string
param workspaceCustomerId string
param insightsName string
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
resource insights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: insightsName
}
var mappings = [
  { secret: 'calendar-connection-string', env: 'ConnectionStrings__Calendar' }
  { secret: 'google-client-id', env: 'Auth__Google__ClientId' }
  { secret: 'google-client-secret', env: 'Auth__Google__ClientSecret' }
]
var allowedNames = filter(keyVaultSecretNames, s => contains(['calendar-connection-string', 'google-client-id', 'google-client-secret'], s) || (startsWith(s, 'allowed-email-') && length(s) > 14 && empty(reduce(range(0, 10), substring(s, min(length(s), 14)), (remaining, digit) => replace(remaining, string(digit), '')))))
var fixedEnv = [for mapping in filter(mappings, m => contains(allowedNames, m.secret)): { name: mapping.env, secretRef: mapping.secret }]
// The service name Application Insights shows as the role, whatever the agent puts in OTEL_RESOURCE_ATTRIBUTES, and
// no OTLP metrics, which the agent would drop for Application Insights.
var telemetryEnv = [
  { name: 'OTEL_SERVICE_NAME', value: 'calendar-api' }
  { name: 'OTEL_METRICS_EXPORTER', value: 'none' }
]
var emailEnv = [for secret in filter(allowedNames, s => startsWith(s, 'allowed-email-')): { name: 'Auth__AllowedEmails__${substring(secret, 14)}', secretRef: secret }]
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
    // The managed OpenTelemetry agent (ADR-0062, #738): it receives the app's OTLP over gRPC, at the endpoint it
    // injects as OTEL_EXPORTER_OTLP_ENDPOINT, and sends traces and logs to Application Insights. Application
    // Insights takes no metrics from it, so the app turns its metrics exporter off (below); request metrics come
    // from the Container Apps platform metrics.
    appInsightsConfiguration: { connectionString: insights.properties.ConnectionString }
    openTelemetryConfiguration: {
      tracesConfiguration: { destinations: [ 'appInsights' ] }
      logsConfiguration: { destinations: [ 'appInsights' ] }
    }
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
      secrets: [for secret in allowedNames: { name: secret, keyVaultUrl: '${vaultUri}secrets/${secret}', identity: identityId }]
    }
    template: {
      containers: [ {
        name: 'calendar'
        image: containerImage
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        env: concat(fixedEnv, emailEnv, telemetryEnv)
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

output outboundIps array = app.properties.outboundIpAddresses
