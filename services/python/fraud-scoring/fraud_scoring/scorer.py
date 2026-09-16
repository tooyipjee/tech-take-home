from .rules import BLOCK_THRESHOLD, RULES, STEP_UP_THRESHOLD, Transaction


def score(tx: Transaction) -> int:
    return min(100, sum(rule(tx) for rule in RULES))


def decide(tx: Transaction) -> str:
    """One of 'allow', 'step_up', 'block'."""
    s = score(tx)
    if s >= BLOCK_THRESHOLD:
        return "block"
    if s >= STEP_UP_THRESHOLD:
        return "step_up"
    return "allow"
