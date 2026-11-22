import heapq
from typing import Dict, List, Tuple


def compute_equal_splits(amount_cents: int, member_ids: List[int]) -> List[Tuple[int, int]]:
    """
    Splits amount_cents equally across unique member_ids using integer math.
    Any remainder pennies (amount_cents % n) are distributed 1 cent at a time
    deterministically to the first `remainder` participants (sorted by member_id),
    guaranteeing sum(shares) == amount_cents with zero floating-point drift.
    """
    if amount_cents <= 0:
        raise ValueError("Expense amount must be greater than $0.00.")
    if not member_ids:
        raise ValueError("At least one member must be included in the split.")

    unique_ids = sorted(set(member_ids))
    n = len(unique_ids)
    base_share = amount_cents // n
    remainder = amount_cents % n

    splits: List[Tuple[int, int]] = []
    for idx, member_id in enumerate(unique_ids):
        share = base_share + (1 if idx < remainder else 0)
        splits.append((member_id, share))
    return splits


def validate_exact_splits(amount_cents: int, custom_splits: Dict[int, int]) -> List[Tuple[int, int]]:
    """
    Validates that custom splits are non-negative and sum strictly to amount_cents.
    """
    if amount_cents <= 0:
        raise ValueError("Expense amount must be greater than $0.00.")
    if not custom_splits:
        raise ValueError("At least one member must be included in the split.")

    for member_id, share in custom_splits.items():
        if share < 0:
            raise ValueError(f"Share for member {member_id} cannot be negative.")

    total_allocated = sum(custom_splits.values())
    if total_allocated != amount_cents:
        diff = (amount_cents - total_allocated) / 100.0
        raise ValueError(
            f"Split shares (${total_allocated / 100:.2f}) must equal total expense "
            f"(${amount_cents / 100:.2f}). Difference: ${diff:+.2f}."
        )

    return [(mid, share) for mid, share in custom_splits.items() if share > 0]


def simplify_debts(net_balances: Dict[int, int], member_names: Dict[int, str]) -> List[Dict]:
    """
    Greedy Minimum-Cash-Flow settlement algorithm in O(N log N) time.
    - Creditors: net_balance > 0 (they are owed money)
    - Debtors:   net_balance < 0 (they owe money)
    Repeatedly matches the largest debtor with the largest creditor using max-heaps
    until all balances are settled to 0 cents.
    """
    # Python heapq is a min-heap, so negate amounts to simulate a max-heap
    creditors: List[Tuple[int, int]] = []  # (-credit_cents, member_id)
    debtors: List[Tuple[int, int]] = []    # (-debt_cents, member_id)

    for member_id, balance in net_balances.items():
        if balance > 0:
            heapq.heappush(creditors, (-balance, member_id))
        elif balance < 0:
            heapq.heappush(debtors, (balance, member_id))  # balance is already negative

    settlements: List[Dict] = []

    while creditors and debtors:
        neg_credit, creditor_id = heapq.heappop(creditors)
        neg_debt, debtor_id = heapq.heappop(debtors)

        credit = -neg_credit
        debt = -neg_debt
        transfer = min(credit, debt)

        settlements.append(
            {
                "from_member_id": debtor_id,
                "from_name": member_names[debtor_id],
                "to_member_id": creditor_id,
                "to_name": member_names[creditor_id],
                "amount_cents": transfer,
            }
        )

        remaining_credit = credit - transfer
        remaining_debt = debt - transfer

        if remaining_credit > 0:
            heapq.heappush(creditors, (-remaining_credit, creditor_id))
        if remaining_debt > 0:
            heapq.heappush(debtors, (-remaining_debt, debtor_id))

    return settlements