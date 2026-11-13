# CI timings test migration inventory

Original source: `d4e86f597` (the reporting sources match the initial `56b17db9b` tree). Every original test method and InlineData row below is represented in the replacement suites. Closely related assertions share Deno test groups; method count is not test discovery count.

| Original source | Test method | Cases | Replacement |
| --- | --- | --: | --- |
| ci-timings.tests.cs | ParseRuns_ReadsTheRunListFields | 1 | timings_test.ts |
| ci-timings.tests.cs | ParseRuns_ReadsTheHeadBranchWhenListed | 1 | timings_test.ts |
| ci-timings.tests.cs | ParseRuns_ReadsTheHeadShaWhenListed | 1 | timings_test.ts |
| ci-timings.tests.cs | ParseJobs_KeepsCompletedJobsAndSteps_AndLeavesOutPendingAndSkippedJobs | 1 | timings_test.ts |
| ci-timings.tests.cs | ParseJobs_KeepsEachStepsConclusion | 1 | timings_test.ts |
| ci-timings.tests.cs | Pair_MatchesEachCancelledPullRequestRunWithTheNextRunOfItsBranch_NewestFirst | 1 | timings_test.ts |
| ci-timings.tests.cs | Measure_BoundsWhenTheRunnersHeardOfTheCancel | 1 | timings_test.ts |
| ci-timings.tests.cs | Measure_LeavesTheBoundsEmpty_WhenNoStepShowsThem | 1 | timings_test.ts |
| ci-timings.tests.cs | Measure_SkipsARunThatHadEndedBeforeTheNextPush | 1 | timings_test.ts |
| ci-timings.tests.cs | FirstJobsStarted_IsNull_WithoutJobCreationTimes | 1 | timings_test.ts |
| ci-timings.tests.cs | IsBookkeeping_RecognisesTheRunnersOwnSteps | 5 | timings_test.ts |
| ci-timings.tests.cs | Summarize_UsesNearestRankPercentiles | 1 | statistics_test.ts |
| ci-timings.tests.cs | Summarize_EvenCount_TakesTheLowerMiddle | 1 | statistics_test.ts |
| ci-timings.tests.cs | Summarize_EmptySample_IsZeros | 1 | statistics_test.ts |
| ci-timings.tests.cs | JobsTable_GroupsByName_SlowestMedianFirst | 1 | timings_test.ts |
| ci-timings.tests.cs | StepsTable_GroupsStepsOfOneJob_InStepOrder | 1 | timings_test.ts |
| ci-timings.tests.cs | SupersededTable_ShowsOneRowPerPair_WithADashForAMissingBound | 1 | timings_test.ts |
| ci-timings.tests.cs | SupersessionSummary_CountsEachSegmentOverThePairsThatHaveIt | 1 | timings_test.ts |
| ci-timings.tests.cs | SupersessionSummary_ShowsDashesForASegmentWithNoValues | 1 | timings_test.ts |
| ci-timings.tests.cs | Clock_RendersMinutesAndSeconds | 1 | timings_test.ts |
| ci-timings.tests.cs | IsTransient_RetriesServerErrorsOnly | 1 | timings_test.ts |
| BaselineTests.cs | NormalQuantile_MatchesTheTable | 5 | statistics_test.ts |
| BaselineTests.cs | NormalQuantile_RejectsTheEnds | 2 | statistics_test.ts |
| BaselineTests.cs | UpperBound_WithNoFailures_IsOneMinusTheRootOfFivePercent | 1 | statistics_test.ts |
| BaselineTests.cs | UpperBound_WithOneFailureInThirty_MatchesClopperPearson | 1 | statistics_test.ts |
| BaselineTests.cs | UpperBound_WhenEveryTrialFailed_IsOne | 1 | statistics_test.ts |
| BaselineTests.cs | BinomialCdf_SumsTheTerms | 1 | statistics_test.ts |
| BaselineTests.cs | Z_ForATenthOfAPercentAcrossFiveJobs_IsAbout3Point54 | 1 | baseline_test.ts |
| BaselineTests.cs | Threshold_OfAStableJob_IsTheFloorAboveTheMedian | 1 | baseline_test.ts |
| BaselineTests.cs | Threshold_OfALongStableJob_IsTheRelativeMarginAboveTheMedian | 1 | baseline_test.ts |
| BaselineTests.cs | Threshold_OfASpreadJob_IsTheLogNormalBound | 1 | baseline_test.ts |
| BaselineTests.cs | Derive_UsesNearestRankStatistics | 1 | baseline_test.ts |
| BaselineTests.cs | Derive_OfAnEmptySample_Throws | 1 | baseline_test.ts |
| BaselineTests.cs | Threshold_IsNotPushedUpAWholeSecondByRoundingNoise | 1 | baseline_test.ts |
| BaselineTests.cs | PathOf_IsPublicationWheneverTheDocsSitePublicationStepSucceeded | 1 | baseline_test.ts |
| BaselineTests.cs | PathOf_IsCheckWhenThePublicationStepWasSkipped_WhateverTheEvent | 1 | baseline_test.ts |
| BaselineTests.cs | PathOf_IgnoresAStepOfTheSameNameInAnotherJob | 1 | baseline_test.ts |
| BaselineTests.cs | Samples_KeepOnlyGatedJobsThatSucceeded_AllOnTheRunsPath | 1 | baseline_test.ts |
| BaselineTests.cs | IsMain_KeepsPushAndDispatchRunsOnMain | 5 | baseline_test.ts |
| BaselineTests.cs | IsSuccessful_KeepsOnlyCompletedSuccesses | 1 | baseline_test.ts |
| BaselineTests.cs | Build_SplitsPathsMarksThinPathsProvisionalAndSetsJFromTheJobs | 1 | baseline_test.ts |
| BaselineTests.cs | Build_WithNoSampleOnAPath_LeavesThePathOut | 1 | baseline_test.ts |
| BaselineTests.cs | Write_ThenRead_GivesTheSameBaseline | 1 | baseline_test.ts |
| BaselineTests.cs | Write_IsDeterministicAndStatesTheWindowAndConstants | 1 | baseline_test.ts |
| BaselineTests.cs | Evaluate_CountsOnlyDurationsAboveTheThreshold_AndSkipsJobsWithoutABaseline | 1 | baseline_test.ts |
| BaselineTests.cs | Evaluate_LeavesOutTheBaselinesOwnRuns | 1 | baseline_test.ts |
| BaselineTests.cs | BackTestTable_ReportsTheRateAndItsUpperBound | 1 | baseline_test.ts |
| BaselineTests.cs | BackTestTable_WithNothingChecked_SaysSo | 1 | baseline_test.ts |
| BaselineTests.cs | Table_AndWindow_ListEveryPathAndJob | 1 | baseline_test.ts |
| BaselineTests.cs | Derive_KeepsTheSampleAscending | 1 | baseline_test.ts |
| BaselineTests.cs | Equals_ComparesTheSampleByValue | 1 | baseline_test.ts |
| BaselineTests.cs | Write_ThenRead_KeepsTheSample | 1 | baseline_test.ts |
| BaselineTests.cs | SampleAsync_ReadsTheJobsOfKeptRunsOnly | 1 | baseline_test.ts |
| BaselineTests.cs | SampleAsync_SkipsUnsuccessfulRunsBeforeAnyJobsCall_OldestFirst | 1 | baseline_test.ts |
| BaselineTests.cs | SampleAsync_RefusesAWindowThatReachesTheListLimit | 1 | baseline_test.ts |
| TrendTests.cs | MannWhitney_WhenEveryRecentValueIsLarger_IsOneOverTheNumberOfSplits | 1 | statistics_test.ts |
| TrendTests.cs | MannWhitney_WithTies_UsesMidRanks | 1 | statistics_test.ts |
| TrendTests.cs | MannWhitney_OfIdenticalSamples_IsOneBothWays | 1 | statistics_test.ts |
| TrendTests.cs | MannWhitney_OfAnEmptySample_Throws | 1 | statistics_test.ts |
| TrendTests.cs | TableWidth_IsTheLargestSumThatSizeRanksCanReach | 1 | statistics_test.ts |
| TrendTests.cs | MannWhitney_OnALargeBaseline_KeepsTheTableToTheTwentyLargestRanks | 1 | statistics_test.ts |
| TrendTests.cs | HodgesLehmann_IsTheMedianOfThePairwiseDifferences | 1 | statistics_test.ts |
| TrendTests.cs | HodgesLehmann_IntervalContainsTheShift | 1 | statistics_test.ts |
| TrendTests.cs | AHistoryShiftedByTwentySeconds_IsReportedSlower | 1 | trend_test.ts |
| TrendTests.cs | AnUnshiftedHistory_IsNotReported | 1 | trend_test.ts |
| TrendTests.cs | ASignificantShiftBelowTheMinimumEffect_IsNotReported | 1 | trend_test.ts |
| TrendTests.cs | TheMinimumEffect_GrowsWithALongJob | 1 | trend_test.ts |
| TrendTests.cs | AFasterHistory_IsOnlyASuggestion | 1 | trend_test.ts |
| TrendTests.cs | EachJobIsJudgedOnItsOwn | 1 | trend_test.ts |
| TrendTests.cs | WithFewerRunsThanN_NothingIsConcluded | 1 | trend_test.ts |
| TrendTests.cs | AJobWithoutABaselineOnItsPath_IsLeftOut | 1 | trend_test.ts |
| TrendTests.cs | RecentRuns_AreTheNewestSuccessfulPushesOnMainNotInTheBaseline_OldestFirst | 1 | trend_test.ts |
| TrendTests.cs | RecentRuns_LeaveOutRunsFromBeforeTheBaselineEnds | 1 | trend_test.ts |
| TrendTests.cs | IssueAction_CreatesWhenNoneIsOpen_CommentsOnTheOpenOne_AndDoesNothingWithoutARegression | 1 | trend_test.ts |
| TrendTests.cs | Report_NamesTheJobTheShiftTheWindowAndTheRuns | 1 | trend_test.ts |
| TrendTests.cs | ParseIssues_ReadsNumberAndTitle | 1 | trend_test.ts |
| TrendTests.cs | TheTrendWorkflow_RunsOnScheduleAndDispatchOnly_NeverForAPullRequest | 1 | trend_test.ts |
| TrendTests.cs | TheTrendWorkflow_HasLeastPermissions_AndRunsTheTrendModeWithIssues | 1 | trend_test.ts |
| GateTests.cs | AnOrdinaryPullRequestRun_Passes | 1 | gate_test.ts |
| GateTests.cs | ASlowJobOnAGatingEvent_FailsAndNamesTheJobTimeThresholdAndMedian | 2 | gate_test.ts |
| GateTests.cs | ExactlyAtTheThreshold_Passes | 1 | gate_test.ts |
| GateTests.cs | OneSecondAboveTheThreshold_Fails | 1 | gate_test.ts |
| GateTests.cs | APublishedRun_IsComparedWithThePublicationPath | 1 | gate_test.ts |
| GateTests.cs | AnUnpublishedRun_IsComparedWithTheCheckPath | 1 | gate_test.ts |
| GateTests.cs | AJobWithNoBaselineEntry_WarnsAndPasses | 1 | gate_test.ts |
| GateTests.cs | APathWithNoBaseline_WarnsOnceAndPasses | 1 | gate_test.ts |
| GateTests.cs | ASlowJobOnAMainRun_OnlyWarns | 2 | gate_test.ts |
| GateTests.cs | ASlowJobOnAProvisionalPath_OnlyWarns | 1 | gate_test.ts |
| GateTests.cs | FailedSkippedRunningAndUngatedJobs_AreIgnored | 1 | gate_test.ts |
| GateTests.cs | TheSummary_IsAMarkdownTableAndNeverFails | 1 | gate_test.ts |
| GateTests.cs | TheWorkflow_RunsThisGateFileInCiResult_OnTheSavedJobsResponse | 1 | gate_test.ts |
| GateTests.cs | TheCommittedBaseline_IsReadableByTheTool_AndHoldsBothPaths | 1 | gate_test.ts |

Total: 92 original methods, 107 expanded cases (including all InlineData rows). The three source helper fixture families are retained in the replacement inputs: parser jobs/runs and supersession sample in timings_test.ts, constructed baseline/sampler histories in baseline_test.ts, and rank/trend history sequences in statistics_test.ts and trend_test.ts. Gate fixtures run the unchanged committed jq program, not a TypeScript duplicate.

Additional migration checks: parity_test.ts compares original C# baseline JSON and all eight Markdown report outputs byte for byte; cli_test.ts compares old CLI sampling stdout and invalid-argument stderr/exit behavior using a local deterministic gh responder. No live GitHub call is made by the tests. The statistical table bound is exercised with the original 400-value baseline and 20 recent values.

The workflow caller assertion intentionally changes from the retired direct .cs invocation to the .ts invocation; schedule, permissions and runtime-gate semantics remain asserted. The original JobBaseline C# value-equality case maps to structural object equality including every sampled duration.
