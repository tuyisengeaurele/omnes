-- Enforces double-entry bookkeeping at the database level: every ledger
-- transaction's entries must sum to zero, per currency.
--
-- A plain CHECK constraint cannot see other rows, so this uses a deferred
-- constraint trigger instead. DEFERRABLE INITIALLY DEFERRED means it fires
-- once at commit, after every entry in the transaction has been inserted,
-- rather than after each individual row, which would reject every entry but
-- the last one in a balanced set.
--
-- This is the backstop, not the primary control. Application code should
-- never produce an unbalanced write; this is what makes that a guarantee
-- rather than a hope.

CREATE FUNCTION check_ledger_txn_balance() RETURNS TRIGGER AS $$
DECLARE
  unbalanced_currency TEXT;
  imbalance NUMERIC;
BEGIN
  SELECT currency, SUM(CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END)
  INTO unbalanced_currency, imbalance
  FROM ledger_entries
  WHERE "txnId" = NEW."txnId"
  GROUP BY currency
  HAVING SUM(CASE WHEN direction = 'CREDIT' THEN "amountMinor" ELSE -"amountMinor" END) <> 0
  LIMIT 1;

  IF unbalanced_currency IS NOT NULL THEN
    RAISE EXCEPTION 'ledger transaction % does not balance in %: off by %',
      NEW."txnId", unbalanced_currency, imbalance;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balance_check
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_ledger_txn_balance();
