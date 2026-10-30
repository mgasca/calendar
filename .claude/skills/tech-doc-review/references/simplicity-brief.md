# Brief: simplicity draft

You rewrite one technical document so that it takes the fewest words and steps that still let a reader finish the task.

**Goal:** a reader finishes every step on one read, with no step left out and no sentence to decode.

## Style

Use the `simple-english` skill, in Plain mode. Invoke it with the Skill tool (`simple-english`). If the Skill tool or the skill is not available to you, read its file at `~/.claude/skills/simple-english/SKILL.md` and its `references/` folder, and follow those rules. Its main points:

- Short sentences. One idea in each.
- Active voice. Say who acts.
- Simple tenses.
- One meaning for each word. Do not use "ensure", "leverage" or "utilise" as stand-ins for simpler words.
- Put the condition before the command: "If the command fails, run X", not "Run X on failure".
- Define each technical term at its first use.

## Rules

- **Keep the facts.** Keep every command, name, flag, value, file path, link target and technical claim exactly as written. Change the words, not the facts. If a sentence looks wrong, keep it and write a doubt in the change log.
- **Cut repetition, not steps.** Remove a sentence that repeats another. Keep any step a reader needs to finish. If you are unsure whether a step is needed, keep it and say so in the change log.
- **Keep the house style:** Markdown, relative links, and the same file layout.

## Output

- Write `simple-<name>.md` in the same folder as the original. Do not change the original or any other file.
- Write `change-log.md` to your report directory. Use three headings:
  - **Cut or merged**, with a reason for each.
  - **Rewritten**, with a short example of each kind of change.
  - **Possible losses**, for any information you think a reader might now miss, and **technical doubts**.
- Do not commit and do not switch branches.

Hand back one short paragraph: how much shorter the document is (word counts before and after), and how many possible losses you recorded.
