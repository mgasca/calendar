param location string
param suffix string
param tags object
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-calendar-${suffix}'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}
resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-calendar-${suffix}'
  location: location
  tags: tags
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: workspace.id }
}
output workspaceId string = workspace.id
output workspaceCustomerId string = workspace.properties.customerId

output connectionString string = insights.properties.ConnectionString
output insightsId string = insights.id
