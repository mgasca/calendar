param location string
param suffix string
param tags object
param sku string
@secure()
param administratorPassword string
param allowedFirewallIps array
param allowAzureServices bool
resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: 'psql-calendar-${suffix}'
  location: location
  tags: tags
  sku: { name: sku, tier: 'Burstable' }
  properties: {
    version: '18'
    administratorLogin: 'calendaradmin'
    administratorLoginPassword: administratorPassword
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    storage: { storageSizeGB: 32 }
    network: { publicNetworkAccess: 'Enabled' }
  }
}
resource tls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2025-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: { value: 'on', source: 'user-override' }
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: server
  name: 'calendar'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}
resource firewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = [for (ip, i) in allowedFirewallIps: {
  parent: server
  name: 'allowed-${i}'
  properties: { startIpAddress: ip.startIpAddress, endIpAddress: ip.endIpAddress }
}]
resource azureFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = if (allowAzureServices) {
  parent: server
  name: 'allow-azure-services'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}
