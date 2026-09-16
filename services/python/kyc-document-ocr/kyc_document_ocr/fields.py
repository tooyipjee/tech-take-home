"""Validation of fields read from a passport's machine-readable zone. OCR itself is out of scope here."""

from datetime import date

MRZ_WEIGHTS = (7, 3, 1)


def _char_value(ch: str) -> int:
    if ch == "<":
        return 0
    if ch.isdigit():
        return int(ch)
    return ord(ch.upper()) - ord("A") + 10


def check_digit(field: str) -> int:
    return sum(_char_value(ch) * MRZ_WEIGHTS[i % 3] for i, ch in enumerate(field)) % 10


def parse_mrz_date(yymmdd: str, today: date, expiry: bool) -> date:
    yy, mm, dd = int(yymmdd[0:2]), int(yymmdd[2:4]), int(yymmdd[4:6])
    century = 2000 if (expiry or yy <= today.year % 100) else 1900
    return date(century + yy, mm, dd)


def is_expired(expiry: date, today: date) -> bool:
    return expiry < today


def name_matches(document_name: str, declared_name: str) -> bool:
    norm = lambda s: " ".join(s.replace("<", " ").upper().split())
    return norm(document_name) == norm(declared_name)
