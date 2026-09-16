package com.example.bank.audit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/** Each record hashes the one before it, so a deleted or edited record breaks the chain. */
public final class AuditChain {
    private final List<AuditRecord> records = new ArrayList<>();

    public AuditRecord append(String actor, String action, String subject) {
        String previous = records.isEmpty() ? "genesis" : records.get(records.size() - 1).hash();
        long sequence = records.size() + 1;
        String hash = sha256(sequence + "|" + actor + "|" + action + "|" + subject + "|" + previous);
        AuditRecord record = new AuditRecord(sequence, actor, action, subject, previous, hash);
        records.add(record);
        return record;
    }

    public boolean verify() {
        String previous = "genesis";
        for (AuditRecord r : records) {
            if (!r.previousHash().equals(previous)) return false;
            String expected = sha256(r.sequence() + "|" + r.actor() + "|" + r.action() + "|" + r.subject() + "|" + previous);
            if (!expected.equals(r.hash())) return false;
            previous = r.hash();
        }
        return true;
    }

    public List<AuditRecord> records() {
        return List.copyOf(records);
    }

    static String sha256(String input) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
