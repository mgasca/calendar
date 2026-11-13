## Act 2: Confrontation

### Constraints

Business: a budget of 30,000 euros, launch before the spring season on 1 March, one contractor team of three.

Technical: the venue's payment provider is mandated; box-office tills must keep working offline for up to an hour.

### Challenges

* A popular on-sale concentrates 2,000 buyers into ten minutes.
* Box-office sales and online sales draw on the same seats.

### Driving characteristics

| Characteristic | Business requirement | Target |
| --- | --- | --- |
| Consistency | "No seat may be sold twice" | Zero oversold seats per season |
| Elasticity | "Popular concerts sell out within minutes" | 2,000 concurrent buyers with p95 seat-hold time under 2 seconds |
| Cost | "A budget of 30,000 euros" | Run cost under 300 euros a month outside on-sales |

Candidates considered and set aside: availability (the box office keeps selling offline).

### Alternatives

#### How seats are held

| Alternative | Strengths | Weaknesses against the driving characteristics |
| --- | --- | --- |
| A single database row lock per seat | Simple; consistent | Lock contention at on-sale (elasticity) |
| A hold queue per concert | Fair and fast under load | One more component to run (cost) |
