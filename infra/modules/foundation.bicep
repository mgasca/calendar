param location string
param suffix string
param tags object
param workspaceId string
param deployerPrincipalId string
var secretsUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var acrPull = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: 'crcalendar${suffix}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}
resource vault 'Microsoft.KeyVault/vaults@2026-05-15' = {
  name: 'kv-calendar-${suffix}'
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: { family: 'A', name: 'standard' }
    accessPolicies: []
    enableRbacAuthorization: true
    enabledForTemplateDeployment: true
  }
}
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: vault
  name: 'audit'
  properties: {
    workspaceId: workspaceId
    logs: [ { category: 'AuditEvent', enabled: true } ]
  }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-calendar-${suffix}'
  location: location
  tags: tags
}
resource registryRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, acrPull)
  scope: registry
  properties: { roleDefinitionId: acrPull, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource vaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identity.id, secretsUser)
  scope: vault
  properties: { roleDefinitionId: secretsUser, principalId: identity.properties.principalId, principalType: 'ServicePrincipal' }
}
resource deployerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, deployerPrincipalId, secretsUser)
  scope: vault
  properties: { roleDefinitionId: secretsUser, principalId: deployerPrincipalId, principalType: 'ServicePrincipal' }
}
output registryLoginServer string = registry.properties.loginServer
output identityId string = identity.id
output vaultUri string = vault.properties.vaultUri
