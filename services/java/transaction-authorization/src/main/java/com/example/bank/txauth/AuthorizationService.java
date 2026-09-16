package com.example.bank.txauth;

import java.time.Clock;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;

/**
 * The authorization decision, in the order the rules must be applied:
 * shape → existence → ownership → account status → daily limit → funds → idempotency → debit → audit.
 *
 * Every outcome, approved or declined, is audited with masked identifiers.
 */
public final class AuthorizationService {
    private final AccountRepository accounts;
    private final DailySpendTracker dailySpend;
    private final AuditSink audit;
    private final RequestValidator validator;
    private final Clock clock;
    private final Set<String> seenRequestIds = new HashSet<>();

    public AuthorizationService(AccountRepository accounts, DailySpendTracker dailySpend, AuditSink audit, Clock clock) {
        this.accounts = accounts;
        this.dailySpend = dailySpend;
        this.audit = audit;
        this.validator = new RequestValidator();
        this.clock = clock;
    }

    public Decision authorize(AuthorizationRequest request) {
        if (!validator.isValid(request)) {
            return decline(request, Decision.Reason.INVALID_REQUEST);
        }

        Optional<Account> found = accounts.findById(request.accountId());
        if (found.isEmpty()) {
            return decline(request, Decision.Reason.ACCOUNT_NOT_FOUND);
        }
        Account account = found.get();

        if (!account.ownerCustomerId().equals(request.customerId())) {
            return decline(request, Decision.Reason.NOT_ACCOUNT_OWNER);
        }

        switch (account.status()) {
            case FROZEN -> { return decline(request, Decision.Reason.ACCOUNT_FROZEN); }
            case CLOSED -> { return decline(request, Decision.Reason.ACCOUNT_CLOSED); }
            case ACTIVE -> { }
        }

        LocalDate today = LocalDate.now(clock);
        long spent = dailySpend.spentToday(account.accountId(), today);
        if (spent + request.amountCents() > account.dailyLimitCents()) {
            return decline(request, Decision.Reason.DAILY_LIMIT_EXCEEDED);
        }

        if (request.amountCents() > account.availableBalanceCents()) {
            return decline(request, Decision.Reason.INSUFFICIENT_FUNDS);
        }

        if (!seenRequestIds.add(request.requestId())) {
            return decline(request, Decision.Reason.DUPLICATE_REQUEST);
        }

        account.debit(request.amountCents());
        dailySpend.record(account.accountId(), request.amountCents(), today);

        Decision decision = Decision.approved(request.requestId());
        audit.record(toAudit(request, decision));
        return decision;
    }

    private Decision decline(AuthorizationRequest request, Decision.Reason reason) {
        String requestId = request == null ? null : request.requestId();
        Decision decision = Decision.declined(requestId, reason);
        audit.record(toAudit(request, decision));
        return decision;
    }

    private static AuditEvent toAudit(AuthorizationRequest request, Decision decision) {
        if (request == null) {
            return new AuditEvent(null, null, null, 0, decision.outcome(), decision.reason());
        }
        return new AuditEvent(
                request.requestId(),
                Masking.mask(request.customerId()),
                Masking.mask(request.accountId()),
                request.amountCents(),
                decision.outcome(),
                decision.reason());
    }
}
