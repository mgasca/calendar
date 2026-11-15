## Act 3: Resolution

### The architecture

A web shop and the box-office tills both reserve seats through a hold service that queues requests per concert and writes each sale to one database.

<!-- diagram: containers.mmd -->

### Decisions

#### D1: Seats are held through a queue per concert

- **Context:** 2,000 buyers in ten minutes must never get the same seat.
- **Decision:** every hold goes through a per-concert queue in front of the database.
- **Consequences:** fair ordering and no contention; one more component to operate.
- **Status:** accepted.
- **Rejected alternative:** a row lock per seat, because contention at on-sale misses the elasticity target.

### How the driving characteristics are met

| Characteristic | Target | How the architecture meets it |
| --- | --- | --- |
| Consistency | Zero oversold seats | One writer per concert through the queue |
| Elasticity | 2,000 buyers, p95 hold under 2 s | The queue scales out during on-sales |
| Cost | Under 300 euros a month | The queue scales to zero between on-sales |

### Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Offline tills sell a seat the shop also sold (A1) | medium | high | Tills hold a seat block allocated before going offline |

### Open questions

- Should resale be added next season? The venue manager decides by June.
