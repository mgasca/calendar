---
status: accepted
date: 2026-11-13
---

# 0001 Hold seats through a queue per concert

Every seat hold goes through a per-concert queue in front of the database, so 2,000 buyers in ten minutes never get the same seat. A row lock per seat was rejected: contention at on-sale misses the elasticity target.
