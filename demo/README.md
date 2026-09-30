# Demo workflows

Realistic, readable Temporal workflow files used for **manual** visual verification at the end of each milestone (M3 onward) — not used by the automated test suite (`test/fixtures/` covers that).

- `order-processing-workflow.ts` — a typical order-processing workflow: validation, inventory reservation, payment with a compensating rollback on failure, shipping.
- `report-polling-workflow.ts` — a retry/poll loop: starts a report job, then polls its status on an interval until it completes, fails, or a max attempt count is reached.
- `approval-signal-workflow.ts` — a signal-driven workflow: waits for one of two signals (approve/deny) before finalizing or cancelling a purchase order.

Try them with the real CLI:

```bash
node bin/pathkit analyze demo/report-polling-workflow.ts
node bin/pathkit analyze demo/report-polling-workflow.ts --mermaid   # paste into https://mermaid.live
node bin/pathkit report demo --traces .pathkit/coverage              # after recording traces
```
