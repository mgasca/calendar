#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:package Npgsql@10.0.3
#:package Testcontainers.PostgreSql@4.16.0
#:include ../Infrastructure.cs
#:include ../Database.cs

using Npgsql;
using Shouldly;
using Testcontainers.PostgreSql;
using Xunit;
namespace InfraTool.Integration;
#pragma warning disable CS1591
public sealed class RoleAgreementTests
{
  // File-based apps run from their build directory, so locate the repository from this source file.
  private static string SourceDirectory([System.Runtime.CompilerServices.CallerFilePath] string path = "") => Path.GetDirectoryName(path)!;

  [Fact]
  public async Task GrantsAgreeWithLocalScriptAndAppCannotCreateTables()
  {
    var script = Path.GetFullPath(Path.Combine(SourceDirectory(), "..", "..", "..", "docker", "postgres", "init", "01-roles.sh"));
    await using var reference = new PostgreSqlBuilder("postgres:18.6-alpine").WithDatabase("calendar").WithPassword("admin-password")
      .WithEnvironment("CALENDAR_MIGRATOR_PASSWORD", "migrator-password")
      .WithEnvironment("CALENDAR_APP_PASSWORD", "app-password")
      .WithResourceMapping(new FileInfo(script), "/docker-entrypoint-initdb.d/").Build();
    await using var candidate = new PostgreSqlBuilder("postgres:18.6-alpine").WithDatabase("calendar").WithPassword("admin-password").Build();
    await reference.StartAsync(TestContext.Current.CancellationToken);
    await candidate.StartAsync(TestContext.Current.CancellationToken);
    await using var first = new NpgsqlConnection(reference.GetConnectionString());
    await using var second = new NpgsqlConnection(candidate.GetConnectionString());
    await first.OpenAsync(TestContext.Current.CancellationToken); await second.OpenAsync(TestContext.Current.CancellationToken);
    await Infra.CreateRole(second, "calendar_migrator", "migrator-password");
    await Infra.CreateRole(second, "calendar_app", "app-password");
    await Infra.ApplyGrants(second);
    await Infra.ApplyGrants(second);
    const string snapshot = "SELECT (SELECT rolcanlogin::text || ',' || rolsuper::text || ',' || rolcreatedb::text || ',' || rolcreaterole::text || ',' || rolinherit::text || ',' || rolreplication::text || ',' || rolbypassrls::text FROM pg_roles WHERE rolname = 'calendar_migrator') || '|' || (SELECT rolcanlogin::text || ',' || rolsuper::text || ',' || rolcreatedb::text || ',' || rolcreaterole::text || ',' || rolinherit::text || ',' || rolreplication::text || ',' || rolbypassrls::text FROM pg_roles WHERE rolname = 'calendar_app') || '|' || (SELECT pg_get_userbyid(datdba) || ':' || datacl::text FROM pg_database WHERE datname='calendar') || '|' || coalesce((SELECT string_agg(defaclobjtype::text || ':' || defaclacl::text, ',' ORDER BY defaclobjtype) FROM pg_default_acl), '') || '|' || has_database_privilege('calendar_app','calendar','CONNECT')::text || '|' || has_schema_privilege('calendar_app','public','USAGE')::text || '|' || coalesce((SELECT nspacl::text FROM pg_namespace WHERE nspname='public'), '')";
    await using var a = new NpgsqlCommand(snapshot, first);
    await using var b = new NpgsqlCommand(snapshot, second);
    (await b.ExecuteScalarAsync(TestContext.Current.CancellationToken)).ShouldBe(await a.ExecuteScalarAsync(TestContext.Current.CancellationToken));
    var migratorCs = new NpgsqlConnectionStringBuilder(candidate.GetConnectionString()) { Username = "calendar_migrator", Password = "migrator-password" }.ConnectionString;
    await using var migrator = new NpgsqlConnection(migratorCs);
    await migrator.OpenAsync(TestContext.Current.CancellationToken);
    await using (var createTable = new NpgsqlCommand("CREATE TABLE public.permission_probe (id integer)", migrator)) { await createTable.ExecuteNonQueryAsync(TestContext.Current.CancellationToken); }
    var cs = new NpgsqlConnectionStringBuilder(candidate.GetConnectionString()) { Username = "calendar_app", Password = "app-password" }.ConnectionString;
    await using var app = new NpgsqlConnection(cs);
    await app.OpenAsync(TestContext.Current.CancellationToken);
    await using (var insert = new NpgsqlCommand("INSERT INTO public.permission_probe VALUES (1)", app)) { (await insert.ExecuteNonQueryAsync(TestContext.Current.CancellationToken)).ShouldBe(1); }
    await using (var select = new NpgsqlCommand("SELECT count(*) FROM public.permission_probe", app)) { (await select.ExecuteScalarAsync(TestContext.Current.CancellationToken)).ShouldBe(1L); }
    await using (var update = new NpgsqlCommand("UPDATE public.permission_probe SET id = 2", app)) { (await update.ExecuteNonQueryAsync(TestContext.Current.CancellationToken)).ShouldBe(1); }
    await using (var delete = new NpgsqlCommand("DELETE FROM public.permission_probe", app)) { (await delete.ExecuteNonQueryAsync(TestContext.Current.CancellationToken)).ShouldBe(1); }
    await using var ddl = new NpgsqlCommand("CREATE TABLE public.app_probe (id integer)", app);
    var error = await Should.ThrowAsync<PostgresException>(() => ddl.ExecuteNonQueryAsync(TestContext.Current.CancellationToken));
    error.SqlState.ShouldBe("42501");
    await using (var extraRole = new NpgsqlCommand("CREATE ROLE extra_role LOGIN PASSWORD 'extra-password'; GRANT CONNECT ON DATABASE calendar TO extra_role;", second)) { await extraRole.ExecuteNonQueryAsync(TestContext.Current.CancellationToken); }
    var extraCs = new NpgsqlConnectionStringBuilder(candidate.GetConnectionString()) { Username = "extra_role", Password = "extra-password" }.ConnectionString;
    await using var extra = new NpgsqlConnection(extraCs);
    await extra.OpenAsync(TestContext.Current.CancellationToken);
    await using var extraDdl = new NpgsqlCommand("CREATE TABLE public.extra_probe (id integer)", extra);
    var extraError = await Should.ThrowAsync<PostgresException>(() => extraDdl.ExecuteNonQueryAsync(TestContext.Current.CancellationToken));
    extraError.SqlState.ShouldBe("42501");
  }
}
