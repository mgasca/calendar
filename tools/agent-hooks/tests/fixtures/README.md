# Legacy hook comparison fixtures

`legacy-cases.jsonl` records 558 calls observed while running all 318 original C# hook tests (zero failures or skips) against the hook sources at `d4e86f597`. Each row has the original test/helper name, method, arguments, fake-probe state before and after, and exact result. Ordering is canonical rather than xUnit's parallel execution order. The original sources remain available in Git history.

The capture ran in a scratch copy with unchanged test bodies/assertions. Thin wrappers around public decision/parser methods recorded arguments, results and probe state. The underlying implementation ran unchanged. `HOME` values in test data were replaced with the synthetic `/fixture-home`; replay temporarily uses that same environment. No real checkout path or session identifier is part of the fixture. PascalCase record fields are adapted to TypeScript property names at replay time; dictionary keys and JSON protocol strings are not changed.

| Original suite | Replacement coverage |
| --- | --- |
| `BashGuardTests.cs` | Every call and fake-probe query in `legacy-parity_test.ts`, including wrappers, heredocs, body-source models, private details, unstaged work, shared database and destination PR states. |
| `ShellCommandTests.cs` | Every split/tokenize call and result in the legacy replay, including malformed input and quoting. |
| `EditGuardTests.cs` | Every call with full verdict and reason in the legacy replay; Deno locks added in protocol tests. |
| `ContractCheckTests.cs` | Every changed-file/timestamp combination in the legacy replay, including deleted sources, same-time writes and client regeneration. |
| `PullRequestLinkCheckTests.cs` | Every call and query in the legacy replay. These rows name the suite's `Describe` helper because that is the original immediate caller. |
| `HookRunnerTests.cs` | Every call and complete JSON/exit/stderr result in the legacy replay except the two approved replacements below. Invalid-JSON diagnostics retain exit 2 and the stable diagnostic prefix; parser-specific detail differs by runtime. |
| `PullRequestLookupTests.cs` | Every JSON parsing call in the legacy replay. Every process scenario is ported in `process-and-git_test.ts`: arguments/cwd, missing/failing gh, prompts, stdin closure, timeout and PR text selectors. |
| `ExternalCommandTests.cs` | All six scenarios in `process-and-git_test.ts`, including Linux ETXTBSY retry, literal arguments, closed stdin, environment, failure, time limits and descendant cleanup. |
| `GitProbeTests.cs` | All seven scenarios in `process-and-git_test.ts`: ancestor `.git`, squash delivery, branch/detached state, timestamps, missing/text/binary/oversized files and a FIFO without a writer. Extra tests cover real unstaged queries, untracked files and the default branch. |
| `LineLengthCheckTests.cs` | Approved replacement: `protocol-and-registration_test.ts` tests Deno guidance for tooling TypeScript, passes other paths (including all former C#/migration examples), and makes no content-length decision. |
| `DotnetSdkTests.cs` | Approved replacement: SDK parsing, SDK lookup and compilation warmup are retired. Protocol tests compare the actual running Deno version in SessionStart, including CLI JSON and no extra arguments. General process success/failure/timeout behavior remains covered in the process suite. |

The replay runs 556 recorded calls plus an assertion accounting for the two deliberately replaced `HookRunner` results. It compares complete decisions, reason text, JSON strings, shell segments and probe query sequences. New protocol/registration/CLI and real process/Git tests complete the port. Run with the shared configuration:

```bash
deno test --config tools/deno.json --frozen --no-prompt --allow-read --allow-write --allow-run --allow-env tools/agent-hooks/tests
```

The original baseline command was `env -u BASH_ENV dotnet run tools/agent-hooks/tests/agent-hooks.tests.cs`. `BASH_ENV` is unset to avoid harness initialization changing subprocess behavior. Real Git and shell tests use only task-created temporary resources; they make no GitHub, database or Azure changes.
