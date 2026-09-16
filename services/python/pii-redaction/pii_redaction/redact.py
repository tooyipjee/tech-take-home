"""Redaction for log lines and support notes. Over-redaction is acceptable; under-redaction is not."""

import re

PAN = re.compile(r"\b(?:\d[ -]?){13,19}\b")
SORT_AND_ACCOUNT = re.compile(r"\b\d{2}-\d{2}-\d{2}\s*\d{8}\b")
NI_NUMBER = re.compile(r"\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b", re.IGNORECASE)
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
UK_PHONE = re.compile(r"\b(?:\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b")


def luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _redact_pan(match: re.Match[str]) -> str:
    digits = re.sub(r"[ -]", "", match.group(0))
    if not luhn_ok(digits):
        return match.group(0)
    return f"[PAN ****{digits[-4:]}]"


def redact(text: str) -> str:
    text = PAN.sub(_redact_pan, text)
    text = SORT_AND_ACCOUNT.sub("[ACCOUNT]", text)
    text = NI_NUMBER.sub("[NINO]", text)
    text = EMAIL.sub("[EMAIL]", text)
    text = UK_PHONE.sub("[PHONE]", text)
    return text
