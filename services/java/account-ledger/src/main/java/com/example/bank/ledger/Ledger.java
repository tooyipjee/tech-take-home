package com.example.bank.ledger;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Append-only. A posting is never edited or deleted; a mistake is corrected with a reversing
 * posting that references the original.
 */
public final class Ledger {
    private final List<Posting> postings = new ArrayList<>();

    public Posting append(String accountId, long amountCents, String reference) {
        if (amountCents == 0) throw new IllegalArgumentException("zero posting");
        Posting posting = new Posting("p-" + (postings.size() + 1), accountId, amountCents, Instant.now(), reference);
        postings.add(posting);
        return posting;
    }

    public Posting reverse(String postingId) {
        Posting original = postings.stream().filter(p -> p.postingId().equals(postingId)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("unknown posting " + postingId));
        return append(original.accountId(), -original.amountCents(), "reversal of " + postingId);
    }

    public long balance(String accountId) {
        return postings.stream().filter(p -> p.accountId().equals(accountId)).mapToLong(Posting::amountCents).sum();
    }

    public List<Posting> statement(String accountId, Instant from, Instant to) {
        return postings.stream()
                .filter(p -> p.accountId().equals(accountId))
                .filter(p -> !p.at().isBefore(from) && p.at().isBefore(to))
                .toList();
    }
}
