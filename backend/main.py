import sqlite3
from contextlib import asynccontextmanager
from typing import Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from database import get_connection, init_db
from services import (
    compute_equal_splits,
    compute_percentage_splits,
    simplify_debts,
    validate_exact_splits,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="SplitSmart API", version="1.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Pydantic Request Schemas ---
class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


class MemberCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)


class ExpenseCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=140)
    amount_cents: int = Field(..., gt=0)
    paid_by_member_id: int
    split_type: Literal["equal", "exact", "percentage", "settlement"] = "equal"
    split_member_ids: Optional[List[int]] = None
    exact_splits: Optional[Dict[int, int]] = None       # {member_id: share_cents}
    percentage_bps: Optional[Dict[int, int]] = None     # {member_id: basis_points}


class SettleCreate(BaseModel):
    from_member_id: int
    to_member_id: int
    amount_cents: int = Field(..., gt=0)


# --- Helper to build complete group state ---
def get_group_summary(conn: sqlite3.Connection, group_id: int) -> dict:
    group = conn.execute(
        "SELECT id, name, created_at FROM groups WHERE id = ?", (group_id,)
    ).fetchone()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found.")

    members = conn.execute(
        "SELECT id, name FROM members WHERE group_id = ? ORDER BY id ASC", (group_id,)
    ).fetchall()
    member_list = [{"id": m["id"], "name": m["name"]} for m in members]
    member_names = {m["id"]: m["name"] for m in members}

    expenses_rows = conn.execute(
        """
        SELECT e.id, e.description, e.amount_cents, e.paid_by_member_id,
               m.name AS paid_by_name, e.split_type, e.created_at
        FROM expenses e
        JOIN members m ON e.paid_by_member_id = m.id
        WHERE e.group_id = ?
        ORDER BY e.id DESC
        """,
        (group_id,),
    ).fetchall()

    paid_totals = {m["id"]: 0 for m in members}
    owed_totals = {m["id"]: 0 for m in members}
    expenses_list = []

    for exp in expenses_rows:
        paid_totals[exp["paid_by_member_id"]] += exp["amount_cents"]
        split_rows = conn.execute(
            """
            SELECT es.member_id, m.name, es.share_cents
            FROM expense_splits es
            JOIN members m ON es.member_id = m.id
            WHERE es.expense_id = ?
            ORDER BY es.member_id ASC
            """,
            (exp["id"],),
        ).fetchall()

        splits_formatted = []
        for s in split_rows:
            owed_totals[s["member_id"]] += s["share_cents"]
            splits_formatted.append(
                {
                    "member_id": s["member_id"],
                    "member_name": s["name"],
                    "share_cents": s["share_cents"],
                }
            )

        expenses_list.append(
            {
                "id": exp["id"],
                "description": exp["description"],
                "amount_cents": exp["amount_cents"],
                "paid_by_member_id": exp["paid_by_member_id"],
                "paid_by_name": exp["paid_by_name"],
                "split_type": exp["split_type"],
                "created_at": exp["created_at"],
                "splits": splits_formatted,
            }
        )

    net_balances: Dict[int, int] = {}
    balances_list = []
    for m in member_list:
        mid = m["id"]
        paid = paid_totals[mid]
        owed = owed_totals[mid]
        net = paid - owed
        net_balances[mid] = net
        balances_list.append(
            {
                "member_id": mid,
                "name": m["name"],
                "total_paid_cents": paid,
                "total_share_cents": owed,
                "net_balance_cents": net,
            }
        )

    settlements = simplify_debts(net_balances, member_names)
    # Exclude settlement repayments from total group trip spend
    total_group_spend = sum(
        e["amount_cents"] for e in expenses_list if e["split_type"] != "settlement"
    )

    return {
        "id": group["id"],
        "name": group["name"],
        "total_spend_cents": total_group_spend,
        "members": member_list,
        "expenses": expenses_list,
        "balances": balances_list,
        "settlements": settlements,
    }


# --- API Endpoints ---
@app.get("/api/groups")
def list_groups():
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, created_at FROM groups ORDER BY id DESC"
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/groups", status_code=201)
def create_group(payload: GroupCreate):
    clean_name = payload.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Group name cannot be empty.")
    with get_connection() as conn:
        cur = conn.execute("INSERT INTO groups (name) VALUES (?)", (clean_name,))
        return get_group_summary(conn, cur.lastrowid)


@app.get("/api/groups/{group_id}")
def get_group(group_id: int):
    with get_connection() as conn:
        return get_group_summary(conn, group_id)


@app.delete("/api/groups/{group_id}")
def delete_group(group_id: int):
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM groups WHERE id = ?", (group_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Group not found.")
        return {"deleted": True}


@app.post("/api/groups/{group_id}/members", status_code=201)
def add_member(group_id: int, payload: MemberCreate):
    clean_name = payload.name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Member name cannot be empty.")

    with get_connection() as conn:
        group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found.")

        existing = conn.execute(
            "SELECT id FROM members WHERE group_id = ? AND LOWER(name) = LOWER(?)",
            (group_id, clean_name),
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=400, detail=f"'{clean_name}' is already in this group."
            )

        conn.execute(
            "INSERT INTO members (group_id, name) VALUES (?, ?)", (group_id, clean_name)
        )
        return get_group_summary(conn, group_id)


@app.delete("/api/groups/{group_id}/members/{member_id}")
def remove_member(group_id: int, member_id: int):
    with get_connection() as conn:
        member = conn.execute(
            "SELECT id, name FROM members WHERE id = ? AND group_id = ?",
            (member_id, group_id),
        ).fetchone()
        if not member:
            raise HTTPException(status_code=404, detail="Member not found.")

        paid_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM expenses WHERE paid_by_member_id = ?",
            (member_id,),
        ).fetchone()["cnt"]
        split_count = conn.execute(
            "SELECT COUNT(*) AS cnt FROM expense_splits WHERE member_id = ?",
            (member_id,),
        ).fetchone()["cnt"]

        if paid_count > 0 or split_count > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot remove {member['name']} while they are part of logged expenses. Delete those expenses first.",
            )

        conn.execute("DELETE FROM members WHERE id = ?", (member_id,))
        return get_group_summary(conn, group_id)


@app.post("/api/groups/{group_id}/expenses", status_code=201)
def add_expense(group_id: int, payload: ExpenseCreate):
    clean_desc = payload.description.strip()
    if not clean_desc:
        raise HTTPException(status_code=400, detail="Expense description cannot be empty.")

    with get_connection() as conn:
        group = conn.execute("SELECT id FROM groups WHERE id = ?", (group_id,)).fetchone()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found.")

        valid_members = {
            r["id"]
            for r in conn.execute(
                "SELECT id FROM members WHERE group_id = ?", (group_id,)
            ).fetchall()
        }
        if payload.paid_by_member_id not in valid_members:
            raise HTTPException(status_code=400, detail="Payer does not belong to this group.")

        try:
            if payload.split_type == "equal":
                target_ids = payload.split_member_ids or []
                if not all(mid in valid_members for mid in target_ids):
                    raise HTTPException(status_code=400, detail="Invalid member in split list.")
                splits = compute_equal_splits(payload.amount_cents, target_ids)
            elif payload.split_type == "percentage":
                bps_map = payload.percentage_bps or {}
                if not all(mid in valid_members for mid in bps_map.keys()):
                    raise HTTPException(
                        status_code=400, detail="Invalid member in percentage splits."
                    )
                splits = compute_percentage_splits(payload.amount_cents, bps_map)
            else:
                exact_map = payload.exact_splits or {}
                if not all(mid in valid_members for mid in exact_map.keys()):
                    raise HTTPException(status_code=400, detail="Invalid member in exact splits.")
                splits = validate_exact_splits(payload.amount_cents, exact_map)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        cur = conn.execute(
            """
            INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, split_type)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                group_id,
                clean_desc,
                payload.amount_cents,
                payload.paid_by_member_id,
                payload.split_type,
            ),
        )
        expense_id = cur.lastrowid

        conn.executemany(
            "INSERT INTO expense_splits (expense_id, member_id, share_cents) VALUES (?, ?, ?)",
            [(expense_id, mid, share) for mid, share in splits],
        )

        return get_group_summary(conn, group_id)


@app.post("/api/groups/{group_id}/settle", status_code=201)
def record_settlement(group_id: int, payload: SettleCreate):
    """
    Records a direct repayment from debtor -> creditor as a ledger entry,
    reducing both participants' net balances toward $0.00 without inflating trip spend.
    """
    if payload.from_member_id == payload.to_member_id:
        raise HTTPException(status_code=400, detail="Cannot settle with yourself.")

    with get_connection() as conn:
        members = {
            r["id"]: r["name"]
            for r in conn.execute(
                "SELECT id, name FROM members WHERE group_id = ?", (group_id,)
            ).fetchall()
        }
        if payload.from_member_id not in members or payload.to_member_id not in members:
            raise HTTPException(status_code=400, detail="Members do not belong to this group.")

        desc = f"Settlement: {members[payload.from_member_id]} → {members[payload.to_member_id]}"
        cur = conn.execute(
            """
            INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, split_type)
            VALUES (?, ?, ?, ?, 'settlement')
            """,
            (group_id, desc, payload.amount_cents, payload.from_member_id),
        )
        conn.execute(
            "INSERT INTO expense_splits (expense_id, member_id, share_cents) VALUES (?, ?, ?)",
            (cur.lastrowid, payload.to_member_id, payload.amount_cents),
        )
        return get_group_summary(conn, group_id)


@app.delete("/api/groups/{group_id}/expenses/{expense_id}")
def delete_expense(group_id: int, expense_id: int):
    with get_connection() as conn:
        cur = conn.execute(
            "DELETE FROM expenses WHERE id = ? AND group_id = ?", (expense_id, group_id)
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Expense not found.")
        return get_group_summary(conn, group_id)


@app.post("/api/groups/demo", status_code=201)
def create_demo_group():
    """Seeds a realistic 4-person trip with 4 overlapping expenses for instant demoing."""
    with get_connection() as conn:
        cur = conn.execute("INSERT INTO groups (name) VALUES (?)", ("Chicago Weekend Trip",))
        gid = cur.lastrowid

        names = ["Ashita", "Ravi", "Ana", "Liam"]
        ids = {}
        for n in names:
            c = conn.execute("INSERT INTO members (group_id, name) VALUES (?, ?)", (gid, n))
            ids[n] = c.lastrowid

        demo_expenses = [
            ("Airbnb Stay (2 Nights)", 48000, ids["Ashita"], [ids["Ashita"], ids["Ravi"], ids["Ana"], ids["Liam"]]),
            ("Deep Dish Pizza Dinner", 9600, ids["Ana"], [ids["Ashita"], ids["Ravi"], ids["Ana"], ids["Liam"]]),
            ("Airport Uber & Gas", 6400, ids["Ravi"], [ids["Ravi"], ids["Ana"], ids["Liam"]]),
            ("Architecture Boat Tour", 10000, ids["Ashita"], [ids["Ashita"], ids["Ravi"], ids["Ana"]]),
        ]

        for desc, amt, payer, split_ids in demo_expenses:
            ec = conn.execute(
                "INSERT INTO expenses (group_id, description, amount_cents, paid_by_member_id, split_type) VALUES (?, ?, ?, ?, 'equal')",
                (gid, desc, amt, payer),
            )
            splits = compute_equal_splits(amt, split_ids)
            conn.executemany(
                "INSERT INTO expense_splits (expense_id, member_id, share_cents) VALUES (?, ?, ?)",
                [(ec.lastrowid, mid, share) for mid, share in splits],
            )

        return get_group_summary(conn, gid)