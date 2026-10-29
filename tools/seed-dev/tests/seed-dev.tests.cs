#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:include ../SeedPlan.cs

// Tests for the dev seed's sample data. Run: dotnet run tools/seed-dev/tests/seed-dev.tests.cs

using System.Text.Json;
using Shouldly;
using Xunit;

namespace SeedDev.Tests;

public sealed class SeedPlanTests
{
  private static readonly DateOnly Day = new(2026, 10, 26);
  private static readonly TimeZoneInfo Berlin = TimeZoneInfo.FindSystemTimeZoneById("Europe/Berlin");

  private static (DateTimeOffset Start, DateTimeOffset End) Window(TimeZoneInfo zone) =>
      (SeedPlan.At(Day, TimeOnly.MinValue, zone), SeedPlan.At(Day.AddDays(1), TimeOnly.MinValue, zone));

  [Fact]
  public void SeedKeyIsSentOnRequests()
  {
    using var client = new HttpClient();
    SeedAuthentication.Configure(client, "test-key");
    client.DefaultRequestHeaders.GetValues("X-Dev-Seed-Key").Single().ShouldBe("test-key");
    SeedAuthentication.UnauthorizedMessage.ShouldContain("Development");
    SeedAuthentication.UnauthorizedMessage.ShouldContain("Auth__DevSeedKey");
  }

  [Fact]
  public void Timed_events_carry_the_zone_and_a_valid_range()
  {
    var timed = SeedPlan.Build(Day, Berlin).Events.Where(e => e.AllDay is null).ToList();

    timed.Count.ShouldBeGreaterThanOrEqualTo(5);
    timed.ShouldAllBe(e => e.TimeZone == "Europe/Berlin" && e.Start < e.End);
  }

  [Fact]
  public void Timed_events_include_an_overlap_an_overnight_from_yesterday_and_one_into_tomorrow()
  {
    (DateTimeOffset dayStart, DateTimeOffset dayEnd) = Window(Berlin);
    var timed = SeedPlan.Build(Day, Berlin).Events.Where(e => e.AllDay is null).ToList();

    timed.ShouldAllBe(e => e.Start < dayEnd && e.End > dayStart);
    timed.ShouldContain(e => e.Start < dayStart && e.End > dayStart);
    timed.ShouldContain(e => e.Start < dayEnd && e.End > dayEnd);
    timed.Any(a => timed.Any(b => a != b && a.Start < b.End && b.Start < a.End)).ShouldBeTrue();
  }

  [Fact]
  public void All_day_events_cover_today_one_single_day_and_one_multi_day()
  {
    var allDay = SeedPlan.Build(Day, Berlin).Events.Where(e => e.AllDay == true).ToList();

    allDay.ShouldAllBe(e => e.StartDate <= Day && e.EndDate > Day && e.Start == null);
    allDay.ShouldContain(e => e.EndDate == e.StartDate!.Value.AddDays(1));
    allDay.ShouldContain(e => e.EndDate > e.StartDate!.Value.AddDays(1));
  }

  [Fact]
  public void Tasks_cover_due_today_overdue_undated_and_tomorrow()
  {
    (DateTimeOffset dayStart, DateTimeOffset dayEnd) = Window(Berlin);
    IReadOnlyList<TaskSeed> tasks = SeedPlan.Build(Day, Berlin).Tasks;

    tasks.Count(t => t.DueDate == Day).ShouldBe(2);
    tasks.Count(t => t.DueAt >= dayStart && t.DueAt < dayEnd).ShouldBe(1);
    tasks.Count(t => t.DueDate < Day).ShouldBe(2);
    tasks.Count(t => t is { DueDate: null, DueAt: null }).ShouldBe(1);
    tasks.Count(t => t.DueDate == Day.AddDays(1)).ShouldBe(1);
    tasks.Count(t => t.CompleteAfterCreate).ShouldBe(1);
    tasks.Single(t => t.CompleteAfterCreate).DueDate.ShouldBe(Day.AddDays(-2));
    tasks.ShouldAllBe(t => t.DueDate == null || t.DueAt == null);
  }

  [Fact]
  public void Times_are_anchored_to_local_wall_clock_in_the_zone()
  {
    EventSeed standup = SeedPlan.Build(Day, Berlin).Events.Single(e => e.Title == "Team standup");

    standup.Start!.Value.Offset.ShouldBe(TimeSpan.FromHours(1)); // CET after the 2026-10-25 change
    standup.Start.Value.Hour.ShouldBe(9);
  }

  [Fact]
  public void A_time_skipped_by_a_dst_gap_moves_to_the_first_valid_time()
  {
    var gapDay = new DateOnly(2026, 3, 29);
    DateTimeOffset instant = SeedPlan.At(gapDay, new TimeOnly(2, 30), Berlin);

    instant.ShouldBe(new DateTimeOffset(2026, 3, 29, 3, 0, 0, TimeSpan.FromHours(2)));
  }

  [Fact]
  public void Serialized_bodies_use_camel_case_explicit_offsets_and_omit_unset_members()
  {
    var plan = SeedPlan.Build(Day, Berlin);

    var timed = JsonSerializer.Serialize(plan.Events[0], SeedJson.Default.EventSeed);
    timed.ShouldContain("\"start\":\"2026-10-26T09:30:00+01:00\"");
    timed.ShouldContain("\"timeZone\":\"Europe/Berlin\"");
    timed.ShouldNotContain("allDay");
    timed.ShouldNotContain("startDate");

    var allDay = JsonSerializer.Serialize(plan.Events.First(e => e.AllDay == true), SeedJson.Default.EventSeed);
    allDay.ShouldContain("\"allDay\":true");
    allDay.ShouldContain("\"startDate\":\"2026-10-26\"");
    allDay.ShouldNotContain("timeZone");

    var task = JsonSerializer.Serialize(plan.Tasks.First(t => t.DueAt is not null), SeedJson.Default.TaskSeed);
    task.ShouldContain("\"dueAt\":\"2026-10-26T17:00:00+01:00\"");
    task.ShouldNotContain("dueDate");
  }
}
