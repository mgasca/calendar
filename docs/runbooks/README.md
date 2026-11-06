# Runbooks

Each runbook has a unique positive integer `order` in YAML front matter, specifying the operational sequence. Keep a `## Before you start` section.


## Publishing

The site discovers documents from this directory and lists them in the sidebar. README files hold conventions, not inventories. Numbered documents sort by filename; runbooks sort by their `order` field. Titles and metadata come from each document. Invalid metadata, duplicate identifiers and broken publication links fail the build.
