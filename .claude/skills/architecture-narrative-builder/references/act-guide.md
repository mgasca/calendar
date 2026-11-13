# Act guide

For each act: what it must establish, the gaps that seed the ledger, example question batches and the confirmed summary. Gap identifiers (`S1`, `C1`, `R1`) are used in the ledger. Adapt the wording to the system and audience; the options in the examples are illustrations, so draw real options from what the user has already said.

## Act 1: Setup

The reader should finish Act 1 knowing what problem is being solved, for whom, why now, and the words the rest of the narrative uses.

| Gap | Closed when the ledger has |
| --- | --- |
| S1 Problem | The business problem in one or two sentences, in business terms, not a solution. |
| S2 Context | Where the system sits: the organisation, existing systems, the market or domain. |
| S3 Motive | Why the business is doing this: the outcome it wants, with a measure where possible. |
| S4 Why now | The trigger (deadline, growth, incident, regulation, competitor) and what happens if nothing is done. |
| S5 Stakeholders | Each major player by role (and name when the user offers one): what they need, what they decide, what worries them. |
| S6 Users | Who uses the system, how many, how often, from where, and what a good day looks like for them. |
| S7 Scope | What is in and out, including systems this one must not replace. |
| S8 Vocabulary | The domain terms the narrative uses, each with a one-line definition and no synonyms. |

**Example first batch** (system, audience, problem, mode):

1. "Who is this narrative for?" Options: an architecture review board; a kata panel of judges; new team members; executives deciding funding.
2. "Which best describes the problem?" Options drawn from the user's opening message, plus "something else".

**Example follow-up**, after "we need to move fast because of growth": "You said growth makes this urgent. Which describes it best?" Options: users are growing by a stated percentage per month; a launch date is fixed; the current system is failing under load; a contract requires it.

**Confirmed summary**: problem, motive and why now (one paragraph); stakeholders as a short list of roles with need and decision; users and scale; scope in and out; the vocabulary table. Then write `00-front-matter.md` and `01-setup.md`.

## Between acts: driving characteristics

| Gap | Closed when the ledger has |
| --- | --- |
| K1 Candidates | A candidate list from the catalogue, each linked to an Act 1 statement. |
| K2 Driving set | About three, at most five, each with its business requirement (quoted), a measurable target and the confirmed reason it drives the design; losing candidates with their reason. |

**Example batch**: "Act 1 says enrolment peaks in the first week of term with every student signing in. Is elasticity a driving characteristic?" Options: yes, with a target to confirm next; no, the peak is handled by scheduling; it is about availability instead; not sure (becomes an assumption to agree).

## Act 2: Confrontation

The reader should finish Act 2 understanding why the problem is hard and which forces any solution must balance.

| Gap | Closed when the ledger has |
| --- | --- |
| C1 Business constraints | Budget, deadline, team size and skills, contracts, regulation, organisational rules. |
| C2 Technical constraints | Mandated platforms, existing systems to integrate, data that cannot move, standards. |
| C3 Challenges | What makes this system unusual or hard, each tied to an Act 1 fact. |
| C4 Characteristics | The driving set from K2, written with requirement and target. |
| C5 Alternatives | For each major decision: at least two alternatives with their trade-offs against the driving characteristics and constraints. |
| C6 Panel verdicts | The `alternatives` round settled: each strong objection is answered, accepted as a trade-off, or kept as an open question. |

**Example follow-up**, after "we picked microservices": "What else did you consider for the service structure, and why did it lose?" Options: a modular monolith (lost on independent deployment); serverless functions (lost on cold starts); nothing else was considered (an alternative is still needed: suggest one).

**Confirmed summary**: constraints in two short lists; the challenges; the driving characteristics as a table (characteristic, requirement, target); per decision, the alternatives and their trade-offs. Then write `02-confrontation.md`.

## Act 3: Resolution

The reader should finish Act 3 able to explain the architecture, why each major decision was taken, and what could go wrong.

| Gap | Closed when the ledger has |
| --- | --- |
| R1 Architecture | The proposed architecture in prose and at least one diagram (context or containers), each diagram in its own `.mmd` file. |
| R2 Decisions | An inline ADR summary per major decision: context, decision, consequences, status, rejected alternative; linked to an equivalent ADR when one exists. |
| R3 Characteristics met | How the architecture meets each driving target, or which risk covers the shortfall. |
| R4 Risks | Risks with likelihood, impact and mitigation; every assumption covered. |
| R5 Panel review | The `review` round settled: every objection is a revision, a risk or an open question shown in the narrative. |
| R6 Open questions | Anything still undecided, with who decides and by when. |

**Example batch** on risks: "Assumption A2 says the identity provider handles the term-start peak. How likely is it to fail?" Options: low, it is contractually sized; medium, untested at this scale; high, it failed last year; unknown (keep the risk with a load test as mitigation).

**Confirmed summary**: the architecture in one paragraph with the diagram names; the decisions as one line each; the characteristics with how each target is met; the risk table; the open questions. Then write `03-resolution.md`, `04-assumptions.md` and, when asked, `05-panel.md`.
