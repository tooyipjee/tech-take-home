package com.example.bank.payments;

/** Which rail a payment should use. */
public final class Scheme {
    private Scheme() {}

    public enum Rail { FASTER_PAYMENTS, CHAPS }

    public static Rail choose(long amountCents, boolean sameDayRequired) {
        if (amountCents > PaymentInstruction.FASTER_PAYMENTS_CEILING_CENTS) return Rail.CHAPS;
        if (sameDayRequired && amountCents > 25_000_00L) return Rail.CHAPS;
        return Rail.FASTER_PAYMENTS;
    }
}
