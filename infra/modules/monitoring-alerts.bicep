param location string
param suffix string
param tags object
param alertEmail string
param appId string
param appFqdn string
param insightsId string
param enableAvailabilityTest bool
param availabilityFrequencySeconds int
param serverErrorThreshold int
param serverErrorWindowMinutes int
param serverErrorEvaluationMinutes int
param budgetAmount int
param budgetStartDate string

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-calendar-${suffix}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'calendar'
    enabled: true
    emailReceivers: [{ name: 'owner', emailAddress: alertEmail, useCommonAlertSchema: true }]
  }
}
resource serverErrors 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'calendar-5xx-${suffix}'
  location: 'global'
  tags: tags
  properties: {
    description: 'Three or more server errors in the configured window.'
    severity: 2
    enabled: true
    scopes: [appId]
    evaluationFrequency: 'PT${serverErrorEvaluationMinutes}M'
    windowSize: 'PT${serverErrorWindowMinutes}M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{
        name: 'serverErrors'
        criterionType: 'StaticThresholdCriterion'
        metricNamespace: 'Microsoft.App/containerApps'
        metricName: 'Requests'
        dimensions: [{ name: 'statusCodeCategory', operator: 'Include', values: ['5xx'] }]
        operator: 'GreaterThanOrEqual'
        threshold: serverErrorThreshold
        timeAggregation: 'Total'
      }]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}
resource test 'Microsoft.Insights/webtests@2022-06-15' = if (enableAvailabilityTest) {
  name: 'calendar-ready-${suffix}'
  location: location
  kind: 'standard'
  tags: union(tags, { 'hidden-link:${insightsId}': 'Resource' })
  properties: {
    Name: 'calendar-ready-${suffix}'
    SyntheticMonitorId: 'calendar-ready-${suffix}'
    Kind: 'standard'
    Enabled: true
    Frequency: availabilityFrequencySeconds
    Timeout: 30
    RetryEnabled: true
    Locations: [{ Id: 'emea-ru-msa-edge' }]
    Request: { RequestUrl: 'https://${appFqdn}/api/health/ready', HttpVerb: 'GET', FollowRedirects: true }
    ValidationRules: { ExpectedHttpStatusCode: 200, IgnoreHttpStatusCode: false, SSLCheck: true }
  }
}
resource availability 'Microsoft.Insights/metricAlerts@2018-03-01' = if (enableAvailabilityTest) {
  name: 'calendar-availability-${suffix}'
  location: 'global'
  tags: tags
  properties: {
    severity: 2
    enabled: true
    scopes: [test.id, insightsId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: { 'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria', webTestId: test.id, componentId: insightsId, failedLocationCount: 1 }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'calendar-monthly'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate, endDate: '${int(substring(budgetStartDate, 0, 4)) + 10}${substring(budgetStartDate, 4)}' }
    notifications: {
      actual: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 80, thresholdType: 'Actual', contactEmails: [alertEmail] }
      forecast: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 100, thresholdType: 'Forecasted', contactEmails: [alertEmail] }
    }
  }
}
