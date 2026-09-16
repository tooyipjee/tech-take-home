package com.example.bank.payments;

public record PaymentInstruction(String sortCode, String accountNumber, long amountCents, String reference) {

    public static final long FASTER_PAYMENTS_CEILING_CENTS = 1_000_000_00L;

    public PaymentInstruction {
        if (!SortCode.isValid(sortCode)) throw new IllegalArgumentException("invalid sort code");
        if (accountNumber == null || !accountNumber.matches("\\d{8}")) throw new IllegalArgumentException("invalid account number");
        if (amountCents <= 0) throw new IllegalArgumentException("amount must be positive");
        if (amountCents > FASTER_PAYMENTS_CEILING_CENTS) throw new IllegalArgumentException("above scheme ceiling");
        if (reference != null && reference.length() > 18) throw new IllegalArgumentException("reference too long");
        sortCode = SortCode.normalise(sortCode);
    }
}
