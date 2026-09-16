package com.example.bank.txauth;

/** The authorizer's answer. A DECLINED decision always carries a reason code; APPROVED never does. */
public record Decision(String requestId, Outcome outcome, Reason reason) {

    public enum Outcome { APPROVED, DECLINED }

    public enum Reason {
        NONE,
        INVALID_REQUEST,
        ACCOUNT_NOT_FOUND,
        NOT_ACCOUNT_OWNER,
        ACCOUNT_FROZEN,
        ACCOUNT_CLOSED,
        INSUFFICIENT_FUNDS,
        DAILY_LIMIT_EXCEEDED,
        DUPLICATE_REQUEST
    }

    public static Decision approved(String requestId) {
        return new Decision(requestId, Outcome.APPROVED, Reason.NONE);
    }

    public static Decision declined(String requestId, Reason reason) {
        if (reason == Reason.NONE) {
            throw new IllegalArgumentException("a decline needs a reason");
        }
        return new Decision(requestId, Outcome.DECLINED, reason);
    }

    public boolean isApproved() {
        return outcome == Outcome.APPROVED;
    }
}
