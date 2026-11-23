# SplitSmart — Group Expense Tracker & Minimum-Transfer Settlement

SplitSmart lets a group of friends log shared expenses on the fly, track each person's net balance, and compute the simplest set of transfers required to settle up—with zero accounts, zero paywalls, and exact integer-cent accounting.

---

## Tech Stack
- **Backend:** Python 3, FastAPI, Pydantic, SQLite (`split_smart.db`, auto-initialized on startup with `PRAGMA foreign_keys = ON`)
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS
- **Testing:** `pytest` unit test suite (8 tests covering penny remainders, Hamilton's largest-remainder percentage splits, exact splits, circular debts, and multi-party simplification)

---

## How to Run Locally

### 1. Start the Backend (Port 8001)
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```
Interactive OpenAPI / Swagger documentation is available at `http://127.0.0.1:8001/docs`.

### 2. Run Unit Tests
```bash
cd backend
source venv/bin/activate
pytest -v
```

### 3. Start the Frontend
```bash
cd frontend
npm install
npm run dev
```
Open the local URL printed by Vite (typically `http://localhost:5173` or `http://localhost:5174`). Create a new group directly on the home screen, or click **"Or populate a sample 4-person trip"** to load pre-populated demo data.

---

## Key Engineering Decisions & Assumptions

1. **Integer-Cent Monetary Representation (Zero Floating-Point Drift):**
   All currency values are converted to and stored as integer cents (`amount_cents`, `share_cents`) in SQLite and Python to avoid IEEE-754 floating-point precision drift (`0.1 + 0.2 != 0.3`). Formatting to `$X.XX` happens strictly at the UI presentation layer.

2. **Three Split Modes with Deterministic Remainder Allocation:**
   - **Equal Splits (`compute_equal_splits`):** When an amount produces indivisible pennies (e.g., `$10.00` / `1000` cents split 3 ways = `333` cents with `1` cent remaining), leftover pennies (`amount_cents % n`) are distributed deterministically 1 cent at a time ordered by `member_id` (`$3.34`, `$3.33`, `$3.33`).
   - **Percentage Splits (`compute_percentage_splits`):** Percentages are represented in basis points (`100.00% = 10000 bps`) and allocated using **Hamilton's Largest Remainder Method**, distributing fractional leftover cents to participants with the largest remainders.
   - **Exact Dollar Splits (`validate_exact_splits`):** Enforces non-negative amounts that sum strictly to the total expense in cents.
   - All three modes preserve the zero-sum accounting invariant ($\sum \text{shares} = \text{total\_cents}$ and $\sum \text{NetBalance}_i = 0$).

3. **Minimum-Cash-Flow Settlement Algorithm ($O(N \log N)$):**
   Each member's net balance is computed as $\text{Net}_i = \text{TotalPaid}_i - \text{TotalShare}_i$. While finding the globally optimal subset-sum partition of debts is NP-hard, `simplify_debts` uses a greedy max-heap approach (`heapq`) that repeatedly pairs the largest creditor ($\text{Net} > 0$) with the largest debtor ($\text{Net} < 0$) and settles $\min(\text{Credit}, |\text{Debt}|)$. This eliminates circular and transitive debt chains (e.g., `A -> B -> C` collapses to `A -> C`) and guarantees at most $N - 1$ transfers.

4. **Ledger-Based Settlement Tracking ("Mark Paid"):**
   Clicking **Mark Paid** on a recommended transfer records a `settlement` ledger entry from debtor to creditor (`POST /api/groups/{group_id}/settle`). This updates net balances and remaining transfers cleanly while excluding repayments from `total_spend_cents` so trip spending metrics remain accurate.

5. **Validation, Referential Integrity & Scope Assumptions:**
   - Single currency (`USD`) per group.
   - Member names are unique (case-insensitive) within a group.
   - Members can be removed only if they have no associated expenses or splits; once part of ledger history, deletion is blocked to preserve auditability.
   - Deleting an expense cascades cleanly to its `expense_splits` rows and recalculates all group balances atomically.