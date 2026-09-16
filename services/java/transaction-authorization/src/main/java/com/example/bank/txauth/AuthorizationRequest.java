package com.example.bank.txauth;

/** An inbound request to debit an account. Untrusted: every field is validated before use. */
public record AuthorizationRequest(
        String requestId,
        String customerId,
        String accountId,
        long amountCents,
        String currency,
        String merchantCategory) {
}
