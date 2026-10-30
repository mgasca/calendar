# Brief: combined draft

You receive one original document, a clarity draft and a simplicity draft of it, and each draft's change log. Write one combined document that keeps the newcomer-friendly parts of the clear draft and the brevity of the simple draft, and make each conflict between them a deliberate choice.

The two goals compete. Explanation helps a newcomer and costs an expert time. Your job is to decide which one wins in each place, and to say why.

## Trade-off rules

- **Terms:** define each term once, in a short list near the top or at first use. Never repeat a definition.
- **Prerequisites and expected results:** keep them. They are what let a newcomer finish.
- **Steps:** keep a step if dropping it would stop a reader finishing. Cut repetition.
- **Background:** move it to a short section after the steps, or drop it if the reader does not need it.
- **Headings:** keep the original order unless a heading hides the purpose of its section.

## Facts (most important)

- **Commands and values:** every command line from the original must appear unchanged in your draft. You may add a command only if it is checkable against the repository (a file, a Make target, a workflow name, a variable). Give each addition a reason in `decisions.md`. If you cannot check an addition, leave it out and record a doubt.
- **Claims about the repository:** check every claim that names a file, workflow, target, variable or version against the repository. The repository is the checkout you are in. Record in `decisions.md` what you checked and what you found.
- **Contradictions:** where the clear and simple drafts disagree on a fact, prefer the original, and record the disagreement.

## Output

- Write `combined-<name>.md` in the same folder as the original.
- Write `decisions.md` to your report directory with two headings:
  - **Trade-offs:** each conflict you resolved. For each, state the two options, the one you chose, and why. A reviewer will read this first.
  - **Checked against the repository:** what you verified, and any claim you could not verify.
- Do not change the original or the two drafts. Do not commit and do not switch branches.

Hand back one short paragraph: the number of trade-offs you resolved, and any command you could not verify.
