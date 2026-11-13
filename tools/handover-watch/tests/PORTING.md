# Handover watch compatibility inventory

Source baseline: `56b17db9b`, `tests/handover-watch.tests.cs` (48 test methods including theory tables). The original fixtures are retained as `fixtures/First.json` and `fixtures/PullRequests.json`, extracted from the raw C# strings without changing JSON values. Implementation and tests use the frozen shared Deno configuration.

| Original methods / cases | Deno coverage in `watch_test.ts` |
| --- | --- |
| ReadFirst_KeepsOpenClosedAndMergedPrsThatReferenceTheIssue; ReadFirst_LeavesOutAPrBySomeoneWithoutWriteAccess; ReadFirst_LeavesOutAPrFromAnotherRepository; ReadFirst_ListsAPrOnce_WhenItCrossReferencesTheIssueTwice | snapshot keeps trusted same-repository open closed and merged delivery PRs once |
| ReadFirst_WatchesANamedPr_WhoeverOpenedIt_AndANamedPrOnTheTimelineOnce | named outsider PRs are watched and a named timeline PR is read only once |
| ReadFirst_SkipsEmptyReviewWrappersAndPendingReviews_ButKeepsAnEmptyApproval; ReadFirst_LeavesOutAPendingReviewComment; ReviewComments_CarryTheirLocationAndTheCommentTheyAnswer; ReviewComment_OnAnOutdatedLine_UsesTheOriginalLine | review filtering preserves empty approval and inline reply metadata |
| Ids_AboveTwoToThe31_AreReadFromTheStringGitHubSends; BotLogin_GetsTheSuffixTheWebShows_Once; Item_WithoutAnAuthor_HasAnEmptyLogin | database IDs remain decimal strings above 2^31 and 2^53; bot suffix is added once |
| ReadFirst_ReportsGitHubErrors; ReadFirst_Fails_WhenTheIssueIsMissing | snapshot reports GraphQL errors and missing issue, PR or follow-up node |
| References_NeedsAKeywordBeforeTheNumber (all 11 rows) | reference keyword and issue list grammar |
| RunAsync_ReadsTheDeliveryPrsInFull_InASecondQuery; RunAsync_SendsOneQuery_WhenTheIssueHasNoDeliveryPr | fetch reads delivery PRs in a second query and none when absent |
| RunAsync_ReadsTheNextPageOfEveryLongList_OneCallPerRound | fetch pages all long lists together and discovers further delivery PRs |
| RunAsync_StopsFollowingAListThatNeverEnds_AndKeepsWhatItRead | fetch bounds endless pagination but keeps and reports everything already read |
| First_AsksForTheIssue_AndOnlyTheFilterFieldsOfCrossReferencingPrs; First_ReadsEachNamedPrInFull; Next_DeclaresANodeAndCursorVariablePerPage; Next_ReadsDeliveryPrsInFull_UnderTheRepository; Arguments_LetGhFillInTheRepository_AndSendOtherVariablesRaw | queries request only filter fields first; named PRs get full lists and followups use raw variables |
| FirstRun_ListsEveryCommentReviewAndPrStateOnce_InTimeOrder; SecondRun_WithWhatTheFirstRecorded_ListsNothing; PrState_IsNewAgain_WhenThePrChangesState; NewItems_ListsAnItemFetchedTwiceOnce; SeenRecord_IgnoresBlankLinesAndSurroundingWhitespace | watch deduplicates and orders IDs; original watch ordering and exact empty/state render contracts |
| MergedPr_IsStillWatched_AndANewReplyOnItIsListed | new reply on a merged PR is reported with its original reply ID |
| SeenRecord_LivesUnderPlanPerIssue; Parse_ReadsTheIssueExtraPrsAndPeek; Parse_RejectsAnythingElse (all 8 rows); IsTransient_RetriesServerErrorsOnly | CLI parses issue repeated PRs and peek; seen record location and retry classification match original contracts |
| AgentFooter_CountsOnlyAsTheLastUnquotedLine (all 6 rows); QuotedFooterInAHumanReply_IsNotAnAgentPost | original footer table; original watch ordering; agent footer is only the last unquoted nonblank line |
| Render_PrintsAHeaderLinkAndIndentedBodyPerItem; Render_PrState_HasNoAuthorOrBody; Render_WithNoDeliveryPrs_SaysSo | legacy C# rendered output seen state and query text match byte for byte; original watch ordering and exact empty/state render contracts |
| Clean_NormalisesLineEndings_AndReplacesTerminalEscapes; Clean_ReplacesBidirectionalOverrides; Header_StaysOneLine_WhenAFilePathHoldsALineBreak; Render_IndentsEveryBodyLine_SoABodyCannotForgeAHeader | render preserves headers links indentation hidden records and safe terminal output |
| Render_HiddenIssueComment_PrintsTheHeaderAndLinkWithoutTheBody; Render_HiddenPrCommentReviewAndInlineComment_PrintNoBody; Render_HiddenWithoutAReason_IsStillHidden; Header_OmitsTheAssociation_WhenGitHubSendsNone | original hidden records table preserves exact issue and review headers; render preserves headers links indentation hidden records and safe terminal output |
| Queries_AskForTheAssociationAndHiddenState_OfEveryCommentAndReview | every query comment/review projection asks for trust and minimized state |

## Differential evidence

The C# `HandoverWatch.cs` implementation was executed through a temporary file-based oracle before removal. It read the two original JSON fixtures and wrote `legacy-render.txt`, `legacy-seen.txt`, `legacy-first-query.txt` and `legacy-next-query.txt`. The Deno test compares the full render, state bytes and query bytes exactly against those files. The temporary oracle stays outside tracked source; fixtures remain runnable after .NET removal.

The old and new CLI were also run against issue 682 with `--peek`; stdout matched exactly and neither invocation changed seen state. This live check supplements the deterministic fixtures; it is not a claim about every GitHub response.
