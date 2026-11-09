// Tests of the quality section (story 0053, issue #599). Included by delivery-dashboard.tests.cs. The GitHub CLI is never
// called: the tests build runs and jobs by hand.

using CiTimings;
using Shouldly;
using Xunit;

namespace DeliveryDashboard.Tests;

public sealed class QualityClassificationTests
{
  private static readonly DateTimeOffset Noon = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);
  private static readonly HashSet<long> None = [];

  private static WorkflowRun Run(long id, string conclusion, string @event = "pull_request", string branch = "feature", int minutes = 0) =>
    new(id, "completed", conclusion, Noon.AddMinutes(minutes), @event, branch, "abc");

  [Theory]
  [InlineData("success", 1, "passed")]
  [InlineData("success", 2, "passedAfterRerun")]
  [InlineData("failure", 1, "failed")]
  [InlineData("failure", 3, "failed")]
  [InlineData("timed_out", 1, "failed")]
  [InlineData("startup_failure", 1, "failed")]
  [InlineData("cancelled", 1, "cancelled")]
  [InlineData("skipped", 1, "other")]
  [InlineData("neutral", 1, "other")]
  public void A_run_is_classified_by_its_conclusion_and_attempt(string conclusion, int attempt, string expected) =>
    QualityCollector.Classify(Run(1, conclusion), attempt, None).ShouldBe(expected);

  [Fact]
  public void A_cancelled_run_that_a_newer_push_of_the_same_branch_replaced_is_superseded_not_failed()
  {
    QualityInput old = Input(Run(1, "cancelled", minutes: 0));
    QualityInput newer = Input(Run(2, "success", minutes: 5));

    QualityScope scope = QualityCollector.Build("ci.yml", [old, newer]).Scopes.Single(item => item.Scope == "pullRequest");

    scope.Runs.Superseded.ShouldBe(1);
    scope.Runs.Cancelled.ShouldBe(0);
    scope.Runs.Failed.ShouldBe(0);
    scope.Runs.Passed.ShouldBe(1);
  }

  [Fact]
  public void A_cancelled_run_without_a_newer_run_of_its_branch_is_cancelled_not_superseded()
  {
    QualityInput lone = Input(Run(1, "cancelled", branch: "a"));
    QualityInput other = Input(Run(2, "success", branch: "b", minutes: 5));

    QualityScope scope = QualityCollector.Build("ci.yml", [lone, other]).Scopes.Single(item => item.Scope == "pullRequest");

    scope.Runs.Cancelled.ShouldBe(1);
    scope.Runs.Superseded.ShouldBe(0);
  }

  [Fact]
  public void A_cancelled_push_to_main_is_cancelled_even_when_a_later_run_exists()
  {
    QualityInput first = Input(Run(1, "cancelled", "push", "main"));
    QualityInput second = Input(Run(2, "success", "push", "main", 5));

    QualityScope scope = QualityCollector.Build("ci.yml", [first, second]).Scopes.Single(item => item.Scope == "main");

    scope.Runs.Cancelled.ShouldBe(1);
    scope.Runs.Superseded.ShouldBe(0);
  }

  [Fact]
  public void Reruns_are_counted_and_a_pass_after_a_rerun_is_not_a_clean_pass()
  {
    QualityInput clean = Input(Run(1, "success", "push", "main"));
    QualityInput rerun = Input(Run(2, "success", "push", "main", 1), attempt: 2);
    QualityInput failedAgain = Input(Run(3, "failure", "push", "main", 2), attempt: 3);

    QualityScope scope = QualityCollector.Build("ci.yml", [clean, rerun, failedAgain]).Scopes.Single(item => item.Scope == "main");

    scope.Runs.ShouldBe(new RunCounts(1, 1, 1, 0, 0, 0, 2));
    scope.RerunRunIds.ShouldBe([3, 2]);
    scope.FailedRunIds.ShouldBe([3]);
  }

  [Fact]
  public void Runs_in_neither_scope_and_runs_not_completed_are_not_counted()
  {
    QualityInput dispatch = Input(Run(1, "failure", "workflow_dispatch", "main"));
    QualityInput running = new(new AttemptRun(new WorkflowRun(2, "in_progress", string.Empty, Noon, "push", "main", "abc"), 1), []);
    QualityInput branchPush = Input(Run(3, "failure", "push", "feature"));

    QualitySection section = QualityCollector.Build("ci.yml", [dispatch, running, branchPush]);

    section.Sample.Runs.ShouldBe(0);
    section.Sample.IgnoredRuns.ShouldBe(2);
    section.Sample.Window.ShouldBeNull();
  }

  [Fact]
  public void The_window_spans_the_counted_runs()
  {
    QualitySection section = QualityCollector.Build(
      "ci.yml",
      [Input(Run(1, "success", minutes: -30)), Input(Run(2, "success", "push", "main", 10))]);

    section.Sample.Window.ShouldBe(new SampleWindow(Noon.AddMinutes(-30), Noon.AddMinutes(10)));
  }

  [Fact]
  public void Run_id_lists_hold_the_newest_fifty()
  {
    QualityInput[] failures = [.. Enumerable.Range(1, 60).Select(id => Input(Run(id, "failure", "push", "main", id)))];

    QualityScope scope = QualityCollector.Build("ci.yml", failures).Scopes.Single(item => item.Scope == "main");

    scope.Runs.Failed.ShouldBe(60);
    scope.FailedRunIds.Count.ShouldBe(50);
    scope.FailedRunIds[0].ShouldBe(60);
    scope.FailedRunIds[^1].ShouldBe(11);
  }

  [Fact]
  public void The_two_scopes_are_always_present_main_first() =>
    QualityCollector.Build("ci.yml", []).Scopes.Select(item => item.Scope).ShouldBe(["main", "pullRequest"]);

  private static QualityInput Input(WorkflowRun run, int attempt = 1, params AttemptJob[] jobs) => new(new AttemptRun(run, attempt), jobs);
}

public sealed class QualityRateTests
{
  private static readonly DateTimeOffset Noon = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);
  private static readonly QualityRule Rule = new(0.95, 20);

  private static AttemptJob Job(string name, string conclusion, int attempt = 1, params StepResult[] steps) =>
    new(name, conclusion, attempt, steps);

  private static QualityInput Run(long id, string conclusion, int minutes, params AttemptJob[] jobs) =>
    new(new AttemptRun(new WorkflowRun(id, "completed", conclusion, Noon.AddMinutes(minutes), "push", "main", "abc"), 1), jobs);

  [Fact]
  public void Fewer_trials_than_the_rule_needs_are_inconclusive_with_no_rate_and_no_interval()
  {
    JobRate zero = QualityRates.Judge("Backend", false, 0, 19, Rule);
    JobRate all = QualityRates.Judge("Backend", false, 3, 3, Rule);

    zero.ShouldBe(new JobRate("Backend", false, 19, 0, "inconclusive", null));
    all.Verdict.ShouldBe("inconclusive");
    all.Interval.ShouldBeNull();
    all.Failures.ShouldBe(3);
  }

  [Fact]
  public void Enough_trials_give_a_rate_with_a_clopper_pearson_interval()
  {
    JobRate none = QualityRates.Judge("Backend", false, 0, 20, Rule);
    JobRate every = QualityRates.Judge("Backend", false, 20, 20, Rule);

    none.Verdict.ShouldBe("conclusive");
    none.Interval.ShouldBe(new RateInterval(0, 0, 0.1684));
    every.Interval.ShouldBe(new RateInterval(1, 0.8316, 1));
  }

  [Fact]
  public void The_interval_matches_known_values()
  {
    // Exact two-sided 95 % limits: 5 of 10 is 0.1871 to 0.8129; 1 of 10 is 0.0025 to 0.4450.
    QualityRates.Judge("a", false, 5, 10, new QualityRule(0.95, 10)).Interval.ShouldBe(new RateInterval(0.5, 0.1871, 0.8129));
    QualityRates.Judge("a", false, 1, 10, new QualityRule(0.95, 10)).Interval.ShouldBe(new RateInterval(0.1, 0.0025, 0.445));
  }

  [Fact]
  public void A_cancelled_or_skipped_job_is_no_trial_and_a_failed_first_attempt_that_a_rerun_passed_still_counts()
  {
    var jobs = new List<AttemptJob>
    {
      Job("Backend", "success"),
      Job("Backend", "cancelled"),
      Job("Backend", "skipped"),
      Job("Backend", "failure", 1),
      Job("Backend", "success", 2),
      Job("Backend", "timed_out"),
    };
    QualityInput run = Run(1, "success", 0, [.. jobs]);

    JobRate backend = QualityCollector.Build("ci.yml", [run]).Scopes[0].Jobs.Single();

    backend.Trials.ShouldBe(4);
    backend.Failures.ShouldBe(2);
  }

  [Fact]
  public void The_jobs_of_a_cancelled_run_are_no_trials_because_CI_result_fails_when_the_others_are_cancelled()
  {
    QualityInput cancelled = Run(1, "cancelled", 0, Job("CI result", "failure"), Job("Backend", "cancelled"));
    QualityInput passed = Run(2, "success", 1, Job("CI result", "success"), Job("Backend", "success"));

    QualityScope main = QualityCollector.Build("ci.yml", [cancelled, passed]).Scopes[0];

    main.Jobs.Single(job => job.Job == "CI result").Failures.ShouldBe(0);
    main.Jobs.Single(job => job.Job == "CI result").Trials.ShouldBe(1);
    main.Runs.Cancelled.ShouldBe(1);
  }

  [Fact]
  public void The_required_check_is_flagged_and_rows_are_sorted()
  {
    QualityInput run = Run(1, "failure", 0, Job("Tooling", "success"), Job("CI result", "failure"), Job("Backend", "success"));

    IReadOnlyList<JobRate> rows = QualityCollector.Build("ci.yml", [run]).Scopes[0].Jobs;

    rows.Select(row => row.Job).ShouldBe(["Backend", "CI result", "Tooling"]);
    rows.Single(row => row.Required).Job.ShouldBe("CI result");
  }

  [Fact]
  public void Guard_failures_are_counted_per_day_from_the_tooling_step()
  {
    StepResult Step(string conclusion) => new("Test and lint tooling", conclusion);
    QualityInput dayOne = Run(1, "failure", 0, Job("Tooling", "failure", 1, Step("failure")));
    QualityInput dayOneAgain = Run(2, "success", 5, Job("Tooling", "success", 1, Step("success")));
    QualityInput dayTwo = Run(3, "success", 24 * 60, Job("Tooling", "success", 1, Step("success"), new StepResult("Other", "failure")));
    QualityInput skipped = Run(4, "success", 24 * 60 + 5, Job("Tooling", "success", 1, Step("skipped")));

    IReadOnlyList<GuardDay> days = QualityCollector.Build("ci.yml", [dayOne, dayOneAgain, dayTwo, skipped]).Scopes[0].GuardDays;

    days.ShouldBe([new GuardDay(new DateOnly(2026, 11, 9), 2, 1), new GuardDay(new DateOnly(2026, 11, 10), 1, 0)]);
  }
}

public sealed class QualityParserTests
{
  [Fact]
  public void Runs_are_read_with_their_attempt_and_incomplete_entries_are_skipped()
  {
    const string Json = """
      {"total_count":3,"workflow_runs":[
        {"id":11,"status":"completed","conclusion":"success","created_at":"2026-11-09T10:00:00Z","event":"push",
         "head_branch":"main","head_sha":"a","run_attempt":2},
        {"status":"completed","created_at":"2026-11-09T10:00:00Z"},
        {"id":12,"status":"completed","conclusion":null,"created_at":"2026-11-09T10:01:00Z","event":"pull_request"}
      ]}
      """;

    IReadOnlyList<AttemptRun> runs = QualityParser.ParseRuns(Json);

    runs.Select(run => (run.Run.Id, run.Attempt, run.Run.Conclusion)).ShouldBe([(11L, 2, "success"), (12L, 1, string.Empty)]);
  }

  [Fact]
  public void Jobs_of_every_attempt_are_read_with_their_steps()
  {
    const string Json = """
      {"jobs":[
        {"name":"Tooling","conclusion":"failure","run_attempt":1,"steps":[{"name":"Test and lint tooling","conclusion":"failure"}]},
        {"name":"Tooling","conclusion":"success","run_attempt":2,"steps":[]},
        {"conclusion":"success"}
      ]}
      """;

    IReadOnlyList<AttemptJob> jobs = QualityParser.ParseJobs(Json);

    jobs.Select(job => (job.Name, job.Conclusion, job.Attempt)).ShouldBe([("Tooling", "failure", 1), ("Tooling", "success", 2)]);
    jobs[0].Steps.Single().Conclusion.ShouldBe("failure");
  }

  [Theory]
  [InlineData("{}")]
  [InlineData("{\"workflow_runs\":5}")]
  public void A_response_without_the_list_gives_nothing(string json)
  {
    QualityParser.ParseRuns(json).ShouldBeEmpty();
    QualityParser.ParseJobs(json).ShouldBeEmpty();
  }
}

public sealed class QualityRulesTests
{
  private static readonly DateTimeOffset Noon = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

  private static Snapshot With(QualitySection? quality) =>
    new(SnapshotJson.CurrentVersion, new DateOnly(2026, 11, 9), Noon, "mgasca/calendar", CiSnapshot.Build("ci.yml", []), quality);

  private static QualitySection Section()
  {
    AttemptJob[] steady = [.. Enumerable.Range(0, 25).Select(_ => new AttemptJob("Backend", "success", 1, []))];
    AttemptJob[] few = [new AttemptJob("Frontend", "failure", 1, [new StepResult("Test and lint tooling", "failure")])];
    var run = new WorkflowRun(7, "completed", "failure", Noon, "push", "main", "abc");
    return QualityCollector.Build("ci.yml", [new QualityInput(new AttemptRun(run, 1), [.. steady, .. few])]);
  }

  private static string Json() => SnapshotJson.Write(With(Section()));

  [Fact]
  public void A_snapshot_with_a_quality_section_is_valid_and_stable_and_one_without_it_still_is()
  {
    SnapshotRules.Validate(Json()).ShouldBeEmpty();
    SnapshotJson.Write(With(Section())).ShouldBe(Json());
    SnapshotRules.Validate(SnapshotJson.Write(With(null))).ShouldBeEmpty();
    SnapshotRules.Validate(SnapshotJson.Write(With(QualityCollector.Build("ci.yml", [])))).ShouldBeEmpty();
  }

  [Fact]
  public void An_inconclusive_row_is_written_without_a_rate() =>
    Json().ShouldContain("\"verdict\": \"inconclusive\",\n            \"rate\": null");

  [Theory]
  [InlineData("/home/someone/dev", "machine path")]
  [InlineData("session_1a2b3c4d", "session or task handle")]
  [InlineData("someone@example.com", "e-mail address")]
  public void Private_text_in_the_quality_section_fails_at_its_path(string text, string reason)
  {
    var json = Json().Replace("\"Frontend\"", $"\"{text}\"", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain(error => error.StartsWith("$.quality.scopes[0].jobs[1].job", StringComparison.Ordinal)
      && error.Contains(reason));
  }

  [Fact]
  public void A_field_outside_the_schema_in_the_quality_section_fails()
  {
    var json = Json().Replace("\"listQuery\"", "\"actor\": \"x\",\n        \"listQuery\"", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain("$.quality.scopes[0].actor: field is not in the schema");
  }

  [Theory]
  [InlineData("\"listQuery\": \"branch:main event:push\"", "\"listQuery\": \"actor:someone\"", "$.quality.scopes[0].listQuery")]
  [InlineData("\"minTrials\": 20", "\"minTrials\": 30", "$.quality.scopes[0].jobs[0].verdict")]
  [InlineData("\"total\": 1,", "\"total\": 9,", "$.quality.scopes[0].runs.total")]
  [InlineData("\"required\": false", "\"required\": \"no\"", "$.quality.scopes[0].jobs[0].required")]
  [InlineData("\"guards\": \"inferred\"", "\"guards\": \"guessed\"", "$.quality.basis.guards")]
  [InlineData("\n          7\n", "\n          0\n", "$.quality.scopes[0].failedRunIds[0]")]
  public void A_bad_value_in_the_quality_section_fails_at_its_path(string good, string bad, string path)
  {
    var json = Json().Replace(good, bad, StringComparison.Ordinal);

    json.ShouldNotBe(Json());
    SnapshotRules.Validate(json).ShouldContain(error => error.StartsWith(path, StringComparison.Ordinal));
  }

  [Fact]
  public void An_inconclusive_row_with_a_rate_fails()
  {
    var json = Json().Replace("\"rate\": null", "\"rate\": 0", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldContain(error => error.Contains("inconclusive row must carry no rate"));
  }

  [Fact]
  public void A_conclusive_row_whose_interval_excludes_the_rate_fails()
  {
    var json = Json().Replace("\"high\": 0.1372", "\"high\": -0.5", StringComparison.Ordinal);

    json.ShouldNotBe(Json());
    SnapshotRules.Validate(json).ShouldContain(error => error.Contains("low <= rate <= high"));
  }

  [Fact]
  public void A_window_is_required_when_runs_are_counted()
  {
    var json = SnapshotJson.Write(With(QualityCollector.Build("ci.yml", [])))
      .Replace("\"ignoredRuns\": 0", "\"ignoredRuns\": 0,\n \"runs\": 5", StringComparison.Ordinal);

    SnapshotRules.Validate(json).ShouldNotBeEmpty();
  }
}
