import pytest
from services import (
    compute_equal_splits,
    compute_percentage_splits,
    simplify_debts,
    validate_exact_splits,
)


def test_equal_split_penny_remainder():
    # $10.00 (1000 cents) split 3 ways -> 334, 333, 333 (zero lost pennies)
    splits = compute_equal_splits(1000, [1, 2, 3])
    assert splits == [(1, 334), (2, 333), (3, 333)]
    assert sum(share for _, share in splits) == 1000


def test_equal_split_single_penny_across_three():
    # $0.01 (1 cent) split 3 ways -> [(1, 1), (2, 0), (3, 0)]
    splits = compute_equal_splits(1, [1, 2, 3])
    assert splits == [(1, 1), (2, 0), (3, 0)]
    assert sum(share for _, share in splits) == 1


def test_exact_split_validation():
    splits = validate_exact_splits(5000, {1: 3000, 2: 2000})
    assert splits == [(1, 3000), (2, 2000)]

    with pytest.raises(ValueError):
        validate_exact_splits(5000, {1: 3000, 2: 1500})


def test_percentage_split_largest_remainder():
    # $10.00 (1000 cents) split 33.33% / 33.33% / 33.34% -> 333, 333, 334
    splits = compute_percentage_splits(1000, {1: 3333, 2: 3333, 3: 3334})
    assert splits == [(1, 333), (2, 333), (3, 334)]
    assert sum(share for _, share in splits) == 1000


def test_percentage_split_invalid_total():
    with pytest.raises(ValueError):
        compute_percentage_splits(1000, {1: 5000, 2: 4000})


def test_debt_simplification_transitive_chain():
    # Ravi owes Ana $25, Ana owes Ashita $25 -> simplifies to 1 transfer: Ravi pays Ashita $25
    net_balances = {1: 2500, 2: 0, 3: -2500}
    names = {1: "Ashita", 2: "Ana", 3: "Ravi"}
    settlements = simplify_debts(net_balances, names)

    assert len(settlements) == 1
    assert settlements[0]["from_name"] == "Ravi"
    assert settlements[0]["to_name"] == "Ashita"
    assert settlements[0]["amount_cents"] == 2500


def test_debt_simplification_circular_zero_transfers():
    # Circular loop where everyone breaks even -> 0 transfers needed
    net_balances = {1: 0, 2: 0, 3: 0}
    names = {1: "Ashita", 2: "Ana", 3: "Ravi"}
    assert simplify_debts(net_balances, names) == []


def test_debt_simplification_multi_party():
    net_balances = {1: 15000, 2: -5000, 3: -6000, 4: -4000}
    names = {1: "Ashita", 2: "Ravi", 3: "Ana", 4: "Liam"}
    settlements = simplify_debts(net_balances, names)

    assert len(settlements) == 3
    assert sum(s["amount_cents"] for s in settlements) == 15000
    assert all(s["to_name"] == "Ashita" for s in settlements)