package com.example.bank.auth;

/** When a second factor is required before an action proceeds. */
public final class StepUpPolicy {
    private StepUpPolicy() {}

    public static boolean required(String action, long amountCents, boolean newDevice) {
        if (newDevice) return true;
        return switch (action) {
            case "add-payee", "change-contact-details" -> true;
            case "payment" -> amountCents >= 100_00L * 250; // £250
            default -> false;
        };
    }
}
