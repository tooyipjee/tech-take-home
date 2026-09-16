from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Posting:
    posted_on: date
    amount_cents: int
    description: str


@dataclass(frozen=True)
class Statement:
    period_start: date
    period_end: date
    opening_balance_cents: int
    closing_balance_cents: int
    lines: tuple[tuple[date, str, int, int], ...]  # date, description, amount, running balance


def month_bounds(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def build(postings: list[Posting], year: int, month: int, opening_balance_cents: int) -> Statement:
    start, end = month_bounds(year, month)
    in_period = sorted((p for p in postings if start <= p.posted_on < end), key=lambda p: p.posted_on)
    running = opening_balance_cents
    lines = []
    for p in in_period:
        running += p.amount_cents
        lines.append((p.posted_on, p.description, p.amount_cents, running))
    return Statement(start, end, opening_balance_cents, running, tuple(lines))


def render(statement: Statement, currency_symbol: str = "£") -> str:
    def money(cents: int) -> str:
        sign = "-" if cents < 0 else ""
        cents = abs(cents)
        return f"{sign}{currency_symbol}{cents // 100}.{cents % 100:02d}"

    out = [f"Statement {statement.period_start:%B %Y}", f"Opening balance {money(statement.opening_balance_cents)}"]
    for d, desc, amount, bal in statement.lines:
        out.append(f"{d:%d %b}  {desc:<30} {money(amount):>12} {money(bal):>12}")
    out.append(f"Closing balance {money(statement.closing_balance_cents)}")
    return "\n".join(out)
