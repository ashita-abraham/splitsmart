# SplitSmart — Group Expense Tracker & Minimum-Transfer Settlement

SplitSmart lets a group of friends log shared expenses on the fly, track each person's net balance, and compute the simplest set of transfers required to settle up.

## Tech Stack
- **Backend:** Python 3, FastAPI, Pydantic, SQLite (`split_smart.db`, auto-initialized on startup)
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS
- **Testing:** `pytest` unit test suite covering penny remainders, exact splits, and debt simplification

---

## How to Run Locally

### 1. Start the Backend (Port 8001)
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001