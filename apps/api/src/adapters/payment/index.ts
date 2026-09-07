/**
 * PaymentPort: the interface every payment provider adapter implements
 * (MTN Mobile Money, Airtel Money, a card gateway). MockAdapter models real
 * failure modes (pending state, timeout, insufficient funds, duplicate
 * webhook) so swapping in a real provider is a config change, not a rewrite.
 */

export {};
