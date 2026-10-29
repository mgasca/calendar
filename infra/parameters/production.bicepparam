using '../main.bicep'

param environment = 'production'
param postgresSku = 'Standard_B1ms'
param allowAzureServices = false

param enableAvailabilityTest = true

param alertEmail = readEnvironmentVariable('AZURE_ALERT_EMAIL', '')

param monthlyBudgetAmount = 40
