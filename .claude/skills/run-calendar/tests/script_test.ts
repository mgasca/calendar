import { parse, split } from "../scripts/browse/script.ts";

import { assertEquals as equal } from "@std/assert";

const splits: [string, number, string[]][] = [
  ["fill label=Title Buy milk", 3, ["fill", "label=Title", "Buy milk"]],
  ["click text=Week", 2, ["click", "text=Week"]],
  ["fill 'label=Task title' Buy milk", 3, [
    "fill",
    "label=Task title",
    "Buy milk",
  ]],
  ["fill 'role=textbox[name=\"Task title\"]' x", 3, [
    "fill",
    'role=textbox[name="Task title"]',
    "x",
  ]],
  ["eval  document.querySelector('main').innerText ", 2, [
    "eval",
    "document.querySelector('main').innerText",
  ]],
  ["fill label=Notes  two  spaces 'kept' ", 3, [
    "fill",
    "label=Notes",
    "two  spaces 'kept'",
  ]],
  ['click role=button[name="Add task"]', 2, [
    "click",
    'role=button[name="Add task"]',
  ]],
  ["fill   label=Title   x", 3, ["fill", "label=Title", "x"]],
  ["text", 2, ["text"]],
  ["text ", 2, ["text"]],
  ["fill label=Title", 3, ["fill", "label=Title"]],
  ["", 2, []],
  ["fill 'label=Task title", 3, ["fill", "label=Task title"]],
  ["'' x", 2, ["x"]],
];
for (const [line, parts, expected] of splits) {
  Deno.test(`split ${JSON.stringify(line)}`, () => equal(split(line, parts), expected));
}
for (const line of ["", "   ", "# a comment", "  # an indented comment"]) {
  Deno.test(`skip ${JSON.stringify(line)}`, () => equal(parse(line), null));
}
const commands: [string, string, string, string][] = [
  ["fill label=Title Buy milk", "fill", "label=Title", "Buy milk"],
  ["select 'label=Priority' High", "select", "label=Priority", "High"],
  [
    'click role=button[name="Add task"]',
    "click",
    'role=button[name="Add task"]',
    "",
  ],
  ["eval [1, 2].length", "eval", "[1, 2].length", ""],
  ["  nav /week  ", "nav", "/week", ""],
  ["text", "text", "", ""],
  ["screenshot", "screenshot", "", ""],
  ["bogus a b", "bogus", "a b", ""],
  ["''", "", "", ""],
];
for (const [line, name, target, rest] of commands) {
  Deno.test(`parse ${JSON.stringify(line)}`, () => equal(parse(line), { name, target, rest }));
}
