---
date: "2026-11-06"
author: "Claude Code (Claude Opus 5.5)"
revision: "14b9a1dc"
---

# 0002 The handover watch, from finding to fix

*This is a story told on 6 November 2026 by Claude Code (Claude Opus 5.5), the agent that delivered [#363](https://github.com/mgasca/calendar/issues/363). It is told from revision `14b9a1dc`, the merge of [#375](https://github.com/mgasca/calendar/pull/375). The maintainer asked for it, and asked for it to be written from the delivering session as a story, in a welcoming voice. The maintainer's decisions along the way were given in conversation and are recorded on #363 and #375; the opening is checked against the record on [#360](https://github.com/mgasca/calendar/pull/360) and against the session transcripts. The narrator is also one of the characters, so read it as a first-hand account, not an audit.*

Pull up a chair. This is the story of a small tool, a number that grew while nobody was looking, and the afternoon a fix got better because someone was asked to find fault with it.

## A tool that waits

When an agent hands work back to the maintainer in this repository, it doesn't sit and stare at GitHub. It runs the **handover watch**, `just tools handover-watch <issue>`, every five minutes. The watch looks at the issue and at every pull request that belongs to it, prints whatever is new since last time, and remembers what it has shown. A comment, an approval, a merge: anything the agent should react to turns up on the next tick.

The watch was born on the afternoon of 6 November, in [#360](https://github.com/mgasca/calendar/pull/360), as part of epic [#318](https://github.com/mgasca/calendar/issues/318) ([story 0027](../stories/0027-focus-agent-guidance-on-claude-code-for-a-while.md)). It worked well. It was correct, it was tested, and its output was easy for an agent to read. There was just one thing.

## The number that grew

Before anyone asked to merge #360, the session building it did what the `issue-handover` skill asks of every code change: it sent in a `performance-reviewer`. At 16:23:58Z the [review](https://github.com/mgasca/calendar/pull/360#issuecomment-6689752931) came back, and its first finding was a quiet little formula: **2 + 3N**.

Every tick, the watch started two `gh` calls for the issue and then three more for each delivery PR, *including the ones merged long ago*. At about 0.65 s per call, the epic #318, which then had 3 PRs, cost 11 calls and roughly 3.5 seconds a tick. An epic with ten PRs would take around 32 calls and five seconds (inferred). Nothing was broken. But the cost grew with every PR an issue had ever had, and it never shrank.

What makes this review a pleasure to read is that it didn't stop at the complaint. The reviewer tried the alternative: one GraphQL query returning the same data for #318, measured at **1.0 s and 49 KB**. So the very first mention of the problem already came with a baseline and a sketch of the answer.

The session didn't rush to rewrite. Two seconds after the review, it [posted a question](https://github.com/mgasca/calendar/pull/360#issuecomment-6689753584). The rewrite would be about as large as the PR itself, and at the five-minute interval #319 was about to set, the cost was bearable. Why not merge what worked and give the speed-up its own issue, carrying the review's numbers? It also set one idea aside on purpose: finding 5, shortening what the agent sees for its own and bots' posts, changed behaviour, so it should be asked about rather than slipped in.

The maintainer agreed in conversation, and the answer was [written down on the PR](https://github.com/mgasca/calendar/pull/360#issuecomment-6690054915) at 16:38:21Z. A second earlier, at 16:38:20Z, #363 had appeared. It held the baseline, the proposal, finding 5 as its one open question, and a "done when" that said exactly what to measure. Story 0027 noted the cost as "measured on #360 and not yet paid off" and moved on.

That issue is where I come in.

## Picking up the thread

I started in a fresh session with nothing but #363 and the repository. That is the quiet virtue of a well-written issue: it lets someone with no memory of the afternoon pick the work up cold.

Three things weren't mine to decide, so I asked the maintainer before touching anything:

- **Which card should hold this?** Card 0027, the story the watch already belonged to.
- **Should the output change, as finding 5 suggested?** No: keep it exactly as it is.
- **May I merge?** Yes, once it is green and both reviews are clean.

The answers went onto the issue, marked as given in chat rather than on GitHub, so the record wouldn't depend on my session.

Then the first surprise. The world had moved. #318 now had **nine** delivery PRs, not three, and a tick cost 29 calls and about 4.4 seconds. The issue's "an issue with six or more PRs" case had quietly arrived by itself. So I measured the baseline again before writing a line, and posted it on the issue with the design.

## Proving nothing changed

The promise was that the agent would see exactly what it saw before, only faster. Promises like that are easy to make and hard to keep, so I tried to make it checkable instead.

The old tool and the new one ran side by side on 20 real targets: issues, pull requests watched as if they were issues, and issues with extra PRs named on the command line. Their output was compared byte for byte. No real list in the repository is long enough to need a second GraphQL page, so I also ran a scratch copy with absurdly small pages, 2 items and 1 thread at a time, against the real API. That made every follow-up path actually run.

The comparison earned its keep. It caught two things that would have slipped through: GraphQL leaves the `[bot]` suffix off bot logins, and it sends IDs larger than 2³¹ as strings. Each new behaviour also got a test, and each test was checked by removing the behaviour again in a scratch copy to see it fail. There were ten such controls, each failing between 1 and 15 tests.

The first version was lovely: **one call per tick**, 1.4–1.9 seconds where the old tool took 2.4–4.4. I was rather pleased with it.

## The reviews that changed the ending

Before asking to merge, I sent in two reviewers, one for performance and one for security. I'm glad I did.

The security reviewer noticed something the tests never could, because the tests described my design rather than questioned it. The single query fetched *every* cross-referencing PR's comments, reviews and threads before the watch had a chance to decide it didn't care about them. Anyone, anywhere, could mention the issue from their own repository and decide how much every tick downloads. The same reviewer saw that hitting the follow-up limit threw away the whole tick and printed nothing. The maintainer's answers could have gone silent.

The performance reviewer found that my "1 point per query" only held because GitHub happens not to count connections nested under the timeline. By the documented formula, the query would cost 53. It also caught a number in my benchmark record that I had attributed to the wrong thing.

So the maintainer chose:

- **Two queries.** The first brings only a short header for each PR that mentions the issue; the second asks for comments and reviews only from the PRs that really belong to it.
- **A limit that warns rather than goes quiet.** Past it, the watch prints what it read and names what it didn't.
- **One finding saved for later.** A comment the maintainer has hidden still reaches the agent in full. That predates this work, so it became [#378](https://github.com/mgasca/calendar/issues/378) rather than a change to an output we'd promised to keep.

The performance reviewer also offered a clever way back to a single call, by remembering the PRs in the watch's local record. The maintainer declined it, preferring that what gets fetched never depends on local state, and it is written down as the thing to reconsider.

Both reviewers looked again at the fixes and found nothing left open.

## How it ended

[Benchmark record 0013](../benchmarks/0013-handover-watch-graphql.md) tells the result plainly. On #318, a tick went from **29 calls and 4.45 s to 2 calls and 2.39 s**, receiving about a fifth of the bytes it used to. Between half a second and nearly a second of the one-query speed went to the second call, and an issue with no delivery PRs became about 0.2 s slower. That is the price of the watch no longer letting strangers decide its workload, and it is on the page for anyone who wants to argue about it later.

The maintainer merged #375 while I was still watching its last check finish. Every check on the final head had passed, so close-out simply started from the merge notice: the issue had closed itself through `Closes #363`, `main` held what the PR promised, and CI was green there too.

## A few things to carry forward

- **Ask someone to find fault before you merge.** The review that made this fix slower also made it right, and it did so before anything shipped.
- **Write down decisions where they were made.** Six answers were given in conversation across two PRs, and every one is on GitHub with a note saying where it came from.
- **Expect the ground to move.** In one afternoon, `main` claimed benchmark numbers 0010 and 0011, an epic reserved 0012, and the docs site changed how records are listed. Check before you number, and merge `main` before you push.
- **Little traps cost more than big decisions.** The file-writing tool once turned escaped characters in C# source into the characters themselves and broke the build. A waiting script once mistook a check that hadn't finished for one that had. A check that ran afterwards caught both, not care alone.

## What this story can't tell you

The narrator did much of the work described here, and the maintainer reviews this story in its PR. The timings come from one laptop under other load, comparing versions within one session; the one-query comparison spans two sessions and is marked as inferred. The follow-up and second-query paths ran against the real API only with shrunken pages. GitHub's GraphQL accounting was measured, not documented, and may change.
