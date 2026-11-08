---
type: llm
focus: output
weight: 1
---

The report has a Coverage section that states how many sessions were in the window, how many were deep-read and which were not read and why, and whether the history index lagged the daemon; and its last line is a watermark of the form `dream-weaver watermark <UTC time> sessions=<ids> main=<sha>`.

When earlier reports are discoverable through the owning card or issue, a missing supplied watermark must not cause the report to call itself the first run. It names the earlier report and any boundary it could recover, honours an explicit shorter window, and states gaps rather than claiming a continuous incremental read. If a baseline comparison is possible, it states counting rules and unequal coverage, and uses unknown rather than zero for a signal not fully assessed. An incremental run considers continuing sessions, or explicitly reports that their message boundaries could not be recovered.
