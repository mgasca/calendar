# Characteristics catalogue

Candidates for the driving architecture characteristics. Propose only those an Act 1 statement points to, then narrow with the user to about three and never more than five. A characteristic drives the design only when it has a **business requirement** the user stated and a **measurable target**; everything else is a quality the system should have but that does not shape the architecture, and stays out of the driving set.

Why so few: each driving characteristic pulls the design and many pull against each other (scalability against cost, security against usability). A long list means none of them really decides anything.

| Characteristic | Definition | Business signals | Example measurable targets |
| --- | --- | --- | --- |
| Performance | Response time and throughput under expected load | Users abandon slow pages; real-time decisions | p95 response under 300 ms at 500 requests/s |
| Scalability | Handles growth in users, data or requests with proportional resources | User base doubling; new markets | 10x users with linear cost; 2,000 concurrent users |
| Elasticity | Absorbs sudden peaks and scales back | Term start, ticket sales, campaigns | 20x traffic within 2 minutes, back to baseline within 15 |
| Availability | The share of time the system is usable | Lost revenue per hour down; 24/7 users | 99.9% monthly; planned downtime under 1 hour/month |
| Reliability | Produces correct results without failure over time | Wrong results cost money or trust | Fewer than 1 failed transaction in 10,000 |
| Fault tolerance | Keeps working when a component fails | Dependencies on flaky partners | Partner outage degrades one feature only; no data loss |
| Recoverability | Returns to service and data after a disaster | Regulatory or contractual recovery terms | RTO 4 hours, RPO 15 minutes |
| Security | Protects against unauthorised access and change | Personal, financial or health data; attacks seen | No critical findings in the annual test; MFA for all staff |
| Privacy | Handles personal data lawfully and minimally | GDPR or similar; consent | Erasure within 30 days; no personal data in logs |
| Auditability | Records who did what, verifiably | Regulators, disputes, finance | Every change traceable to a person for 7 years |
| Data integrity | Data stays consistent and correct | Money, inventory, bookings | Zero double bookings; daily reconciliation within 0.01% |
| Interoperability | Exchanges data with other systems | Many partners or legacy systems | New partner onboarded in 2 weeks via a published API |
| Maintainability | Ease of changing the system | Frequent business change; small team | A typical change ships within 2 days; one team owns it |
| Testability | Ease of verifying behaviour | Regulated releases; costly defects | 90% of rules covered by automated tests; suite under 10 minutes |
| Deployability | Ease and safety of releasing | Weekly or daily releases wanted | Release in under 30 minutes, rollback in under 5 |
| Observability | Seeing what the system does in production | Hard-to-diagnose incidents | Any failed request traceable end to end within 5 minutes |
| Configurability | Behaviour changed without code | Per-customer rules; frequent pricing changes | New tenant configured in a day without a release |
| Extensibility | New features added without reworking the core | A roadmap of add-ons; partners building on it | A new product type added without changing existing modules |
| Usability | Ease of use for the intended users | Occasional or untrained users; support cost | 90% of first-time users finish the main task unaided |
| Accessibility | Usable by people with disabilities | Public sector, legal duty, inclusive brand | WCAG 2.2 AA on every user-facing page |
| Localisation | Works across languages, time zones and regions | International users | Every screen in 3 languages; dates in the user's zone |
| Cost | Run and build cost within budget | Fixed budget; cost per user matters | Run cost under a stated amount per month; cost per user falling with scale |
| Time to market | Delivers the first useful version by a date | A launch date or funding milestone | First release to pilot users by a stated date |
| Portability | Moves between platforms or vendors | Fear of lock-in; multiple clouds | Moves to another provider in under 3 months |

## Narrowing questions

- "Which of these would make the project fail if it were missing?" (keeps the ones that drive)
- "Which of these conflict with each other here, and which wins?" (exposes trade-offs for Act 2)
- "What number would tell you we met it?" (turns an adjective into a target)
- "Which business requirement in Act 1 does this serve?" (rejects characteristics with no motive)

Record every candidate that lost, with the reason, in the ledger: it shows the reader the characteristics were chosen, not assumed.
