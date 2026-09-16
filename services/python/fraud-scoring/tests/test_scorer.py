from fraud_scoring.rules import Transaction
from fraud_scoring.scorer import decide, score


def ordinary(**overrides):
    base = dict(amount_cents=2_000, country="GB", merchant_category="groceries", hour=13, new_device=False, velocity_last_hour=1)
    base.update(overrides)
    return Transaction(**base)


def test_ordinary_transaction_is_allowed():
    assert decide(ordinary()) == "allow"


def test_score_never_exceeds_100():
    tx = ordinary(amount_cents=1_000_000, country="RU", merchant_category="crypto", hour=3, new_device=True, velocity_last_hour=20)
    assert score(tx) == 100
