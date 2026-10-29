using '../main.bicep'

param environment = 'staging'
param postgresSku = 'Standard_B1ms'
param allowAzureServices = false

param alertEmail = readEnvironmentVariable('AZURE_ALERT_EMAIL', '')

param monthlyBudgetAmount = 30
