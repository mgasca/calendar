# Brief: clarity draft

You write a clearer version of one technical document. Your readers may be new to the tools it names, such as a cloud provider, a CLI, a CI system or a database. They can follow instructions, but they do not know the background.

**Goal:** a newcomer can follow each step, knows what they should see after it, and can tell when it has gone wrong.

## Rules

- **Keep the facts.** Keep every command, name, flag, value, file path, link target and technical claim exactly as written. Change the words and the layout, not the facts. If a sentence looks wrong, keep it and write a doubt in the change log. Do not fix it silently.
- **Define terms.** Define each technical term at its first use, in one short sentence. If a term appears in many places, you may add a short "Terms" list near the top instead.
- **Say what comes first.** Before a section, say what the reader needs: access, a tool, or a value from an earlier step.
- **Say what success looks like.** After each command, say what the output should show, and how a reader can tell that it failed.
- **Make hidden steps visible.** For example, say "use the same shell" when a later step uses a variable from an earlier one.
- **Explain why only where a newcomer would guess.** One or two sentences. Skip the rest.
- **Keep the order and the purpose of headings.** Rename a heading only if its current name hides what the section is for. List each rename in the change log.
- **Leave out background** the reader does not need to finish the task.
- **Keep the house style:** Markdown, relative links, and the same file layout.

## Output

- Write `clear-<name>.md` in the same folder as the original. Do not change the original or any other file.
- Write `change-log.md` to your report directory. Use three headings:
  - **Added**, with a reason for each.
  - **Changed or removed**, with a reason for each.
  - **Technical doubts**, for anything you could not confirm from the document itself.
- Do not commit and do not switch branches.

Hand back one short paragraph: what you changed most, and how many doubts you recorded.
