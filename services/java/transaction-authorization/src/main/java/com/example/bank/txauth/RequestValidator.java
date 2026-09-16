package com.example.bank.txauth;

import java.util.Set;
import java.util.regex.Pattern;

/** Shape checks only. Anything that needs account state belongs in AuthorizationService. */
public final class RequestValidator {
    static final long MAX_SINGLE_AMOUNT_CENTS = 1_000_000_00L; // £1,000,000
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");
    private static final Set<String> CURRENCIES = Set.of("GBP", "USD", "EUR");

    public boolean isValid(AuthorizationRequest request) {
        if (request == null) return false;
        if (!isId(request.requestId()) || !isId(request.customerId()) || !isId(request.accountId())) return false;
        if (request.amountCents() <= 0 || request.amountCents() > MAX_SINGLE_AMOUNT_CENTS) return false;
        if (request.currency() == null || !CURRENCIES.contains(request.currency())) return false;
        if (request.merchantCategory() == null || request.merchantCategory().isBlank()) return false;
        return true;
    }

    private static boolean isId(String value) {
        return value != null && ID.matcher(value).matches();
    }
}
