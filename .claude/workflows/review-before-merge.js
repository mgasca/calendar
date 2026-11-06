export const meta = {
  name: 'review-before-merge',
  description: 'Run the performance and security reviewers in parallel, then three skeptics per finding',
  phases: [
    { title: 'Review', detail: 'performance-reviewer and security-reviewer, in parallel' },
    { title: 'Verify', detail: 'three skeptics per finding: true, reproduces, matters' },
  ],
}

// Claude Code only: a Workflow tool script (ADR-0044 Claude-first period; ADR-0017's exception for
// scripts whose language the harness dictates). Story 0035. Other harnesses run the two reviewer
// agents by hand, as .claude/skills/issue-handover/SKILL.md says.
//
// The review before a merge: the two reviewer agents at once, then three skeptics per finding, each
// with its own lens. Returns data for the session to post; it never writes to GitHub itself.
//
// args (all optional): { cap: 60 }  the ceiling on agents per run, reviewers included.

const REVIEWERS = ['performance-reviewer', 'security-reviewer']
const SEVERITIES = ['critical', 'high', 'medium', 'low']
const LENSES = [
  {
    key: 'true',
    question: 'Is the claim true of this code? Read the file and the code around the line. Refute it if the code does not do what the claim says, if an existing defence already covers it, or if the claim rests on a misreading.',
  },
  {
    key: 'reproduces',
    question: 'Does the problem reproduce? Trace the code path or the data that would trigger it; run read-only commands and existing tests where they help. Refute it if you cannot show the mechanism that makes it happen.',
  },
  {
    key: 'matters',
    question: 'Does it matter at the stated severity? Refute it if the severity is overstated for this repository: no growth or frequency mechanism for a performance finding, no reachable path or no protected data for a security finding, or a cost nobody would notice.',
  },
]
const SKEPTICS_PER_FINDING = LENSES.length
const CAP = Number.isInteger(args?.cap) && args.cap > REVIEWERS.length ? args.cap : 60

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Repository-relative path' },
          line: { type: 'integer' },
          claim: { type: 'string', description: 'One or two sentences: what is wrong and why' },
          severity: { type: 'string', enum: SEVERITIES },
          reproduced: { type: 'boolean', description: 'Whether the reviewer reproduced it, not only read it' },
        },
        required: ['file', 'line', 'claim', 'severity', 'reproduced'],
      },
    },
    summary: { type: 'string', description: 'The report the reviewer would otherwise have given, briefly' },
  },
  required: ['findings', 'summary'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string', description: 'One or two sentences with the evidence, file and line' },
  },
  required: ['refuted', 'reason'],
}

const sameFinding = (a, b) => a.reviewer === b.reviewer && a.file === b.file && a.line === b.line && a.claim === b.claim

phase('Review')
const reviews = await parallel(REVIEWERS.map((role) => () =>
  agent(
    `Review the current branch's changes against origin/main as your instructions say. Return every finding as data: repository-relative file, line, the claim in one or two sentences, severity (${SEVERITIES.join(', ')}) and whether you reproduced it. A review with no findings is a valid result.`,
    { agentType: role, label: role, phase: 'Review', schema: FINDINGS },
  ).then((result) => ({ role, result })),
))
const reviewers = REVIEWERS.map((role) => {
  const review = reviews.find((r) => r && r.role === role)
  const result = review ? review.result : null
  return { role, status: result ? 'reported' : 'returned nothing', findings: result?.findings ?? [], summary: result?.summary ?? '' }
})
for (const r of reviewers) if (r.status !== 'reported') log(`${r.role} returned nothing`)

const all = reviewers.flatMap((r) => r.findings.map((f, order) => ({ ...f, reviewer: r.role, order })))
const rank = (severity) => { const i = SEVERITIES.indexOf(severity); return i === -1 ? SEVERITIES.length : i }
all.sort((a, b) => rank(a.severity) - rank(b.severity) || a.reviewer.localeCompare(b.reviewer) || a.order - b.order)

const judgedCount = Math.min(all.length, Math.floor(Math.max(0, CAP - REVIEWERS.length) / SKEPTICS_PER_FINDING))
const toJudge = all.slice(0, judgedCount)
const pastCap = all.slice(judgedCount)
log(`${all.length} finding(s); judging ${toJudge.length}, leaving ${pastCap.length} past the cap of ${CAP} agents`)

phase('Verify')
const judged = await pipeline(toJudge, (f) =>
  parallel(LENSES.map((lens) => () =>
    agent(
      `A reviewer reported this finding on the current branch (compare against origin/main; read-only, do not edit, do not post):\n\nFile: ${f.file}\nLine: ${f.line}\nSeverity: ${f.severity}\nReproduced by the reviewer: ${f.reproduced}\nClaim: ${f.claim}\n\nYour one job is to try to refute it through the "${lens.key}" lens. ${lens.question} Do not judge the other lenses. If you are uncertain, set refuted to true and say why. Give the evidence in the reason, with file and line.`,
      { label: `${lens.key}:${f.file}:${f.line}`, phase: 'Verify', schema: VERDICT },
    ).then((v) => ({ lens: lens.key, refuted: v ? v.refuted : null, reason: v ? v.reason : 'skeptic returned nothing' })),
  )).then((votes) => {
    const declined = votes.filter((v) => v && v.refuted === false).length
    return { ...f, votes, confirmed: declined >= 2 }
  }),
)

const results = judged.filter(Boolean)
const failed = toJudge.filter((f) => !results.some((r) => sameFinding(r, f)))
if (failed.length > 0) log(`${failed.length} finding(s) failed during verification and are listed as unexamined`)
const confirmed = results.filter((f) => f.confirmed)
const refuted = results.filter((f) => !f.confirmed)
const unexamined = [...pastCap, ...failed]
const agents = reviewers.filter((r) => r.status === 'reported').length + results.length * SKEPTICS_PER_FINDING
log(`${confirmed.length} confirmed, ${refuted.length} refuted, ${unexamined.length} unexamined; ${agents} agents answered`)

return {
  confirmed,
  refuted,
  unexamined,
  reviewers: reviewers.map(({ role, status, summary, findings }) => ({ role, status, summary, count: findings.length })),
  cap: CAP,
  agents,
}
