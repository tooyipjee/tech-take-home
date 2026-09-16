"""Each rule returns a score contribution. The sum decides what happens."""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Transaction:
    amount_cents: int
    country: str
    merchant_category: str
    hour: int
    new_device: bool
    velocity_last_hour: int
    home_country: str = "GB"
    typical_amount_cents: int = 5_000
    recent_countries: tuple[str, ...] = field(default=())


STEP_UP_THRESHOLD = 50
BLOCK_THRESHOLD = 80

HIGH_RISK_CATEGORIES = {"gambling", "crypto", "money_transfer"}


def amount_rule(tx: Transaction) -> int:
    if tx.typical_amount_cents <= 0:
        return 0
    ratio = tx.amount_cents / tx.typical_amount_cents
    if ratio >= 20:
        return 40
    if ratio >= 5:
        return 20
    return 0


def geography_rule(tx: Transaction) -> int:
    if tx.country == tx.home_country:
        return 0
    if tx.country in tx.recent_countries:
        return 10
    return 30


def category_rule(tx: Transaction) -> int:
    return 15 if tx.merchant_category in HIGH_RISK_CATEGORIES else 0


def time_rule(tx: Transaction) -> int:
    return 10 if 1 <= tx.hour < 5 else 0


def device_rule(tx: Transaction) -> int:
    return 25 if tx.new_device else 0


def velocity_rule(tx: Transaction) -> int:
    if tx.velocity_last_hour >= 10:
        return 30
    if tx.velocity_last_hour >= 5:
        return 15
    return 0


RULES = (amount_rule, geography_rule, category_rule, time_rule, device_rule, velocity_rule)
