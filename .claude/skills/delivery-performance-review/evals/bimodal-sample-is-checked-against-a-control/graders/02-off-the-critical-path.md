---
type: llm
focus: output
weight: 1
---

The answer works out which job decides the wall clock. In the fast cluster, Web (about 1:30) is shorter than Api's 1:58 median, so Api is the critical path there and Web is not. In the slow cluster, Web (about 2:30) is longer than that median. The answer also notes that Api's single median is taken over both clusters, so Api probably slows on the same runners too, and per-run Api durations would be needed to say which job leads in the slow cluster. It does not claim more than the data shows.
