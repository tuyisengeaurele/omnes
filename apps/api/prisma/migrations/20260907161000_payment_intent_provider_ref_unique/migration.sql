-- A payment webhook reports its outcome by providerRef, so it has to be
-- looked up unambiguously. Safe as a nullable unique column: Postgres never
-- treats two NULLs as duplicates of each other, so multiple payment
-- intents whose initiate() call has not returned a reference yet coexist
-- without conflict.
CREATE UNIQUE INDEX "payment_intents_providerRef_key" ON "payment_intents"("providerRef");
