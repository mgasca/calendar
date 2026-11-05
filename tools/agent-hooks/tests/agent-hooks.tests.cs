#!/usr/bin/env -S dotnet run
#:package xunit.v3.mtp-v2@4.0.2
#:package Shouldly@4.3.0
#:include ../HookProtocol.cs
#:include ../IRepoProbe.cs
#:include ../ShellCommand.cs
#:include ../BashGuard.cs
#:include ../EditGuard.cs
#:include ../LineLengthCheck.cs
#:include ../ContractCheck.cs
#:include ../HookRunner.cs
#:include ../GitProbe.cs
#:include ../DotnetSdk.cs
#:include ../ExternalCommand.cs
#:include ../PullRequestLookup.cs
#:include FakeProbe.cs
#:include BashGuardTests.cs
#:include ShellCommandTests.cs
#:include EditGuardTests.cs
#:include LineLengthCheckTests.cs
#:include ContractCheckTests.cs
#:include HookRunnerTests.cs
#:include GitProbeTests.cs
#:include DotnetSdkTests.cs
#:include ExternalCommandTests.cs
#:include PullRequestLookupTests.cs

// Tests for the Claude Code hooks. Run: dotnet run tools/agent-hooks/tests/agent-hooks.tests.cs
// One test class per file, named after the subject it covers (BashGuardTests.cs tests ../BashGuard.cs); this file is
// the single test app that includes them, so just tools test compiles once. Each hook decision branch gets sample stdin
// JSON and a fake repository probe (FakeProbe.cs); the exit code and JSON are asserted.
