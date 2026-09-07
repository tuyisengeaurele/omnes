# Omnes — Functional & Non-Functional Requirements Specification

**Version:** 1.1 (Draft for build planning — ride-hailing removed from core scope)
**Scope:** Full ecosystem — customer app, driver/courier app, merchant platform, admin & operations backend, and the shared infrastructure connecting them.

---

## 1. System Actors

| Actor | Description |
|---|---|
| **Customer** | End user ordering food, groceries, or sending a parcel |
| **Driver/Courier** | Independent partner fulfilling delivery jobs across verticals |
| **Merchant** | Restaurant, shop, or grocery partner listing products/menu on the platform |
| **Ops/Admin** | Internal Omnes staff managing dispatch, support, fraud, and city operations |
| **Finance/Accounting** | Internal role reconciling payouts, commissions, and settlements |
| **Support Agent** | Internal or outsourced staff resolving customer/driver/merchant tickets |
| **System (automated)** | The dispatch engine, fraud engine, and notification engine acting without direct human input |

---

## 2. Functional Requirements

### 2.1 Identity & Authentication (AUTH)

- **FR-AUTH-001** — The system shall allow account creation via phone number with OTP verification (primary method, given MoMo/Airtel Money numbers are the default identity in this market).
- **FR-AUTH-002** — The system shall support secondary sign-in via email or social login (Google/Apple) for customers who prefer it.
- **FR-AUTH-003** — The system shall maintain one identity per user across every vertical (food, grocery, parcel) — no separate accounts per service.
- **FR-AUTH-004** — Drivers and merchants shall go through a distinct onboarding and verification flow (ID document upload, selfie match, vehicle/business registration) before activation.
- **FR-AUTH-005** — The system shall support role-based access control for internal staff (ops, support, finance, super-admin) with scoped permissions per role.
- **FR-AUTH-006** — The system shall allow account recovery via phone/OTP without requiring email as a fallback, since not all users will have one.
- **FR-AUTH-007** — Sessions shall support silent token refresh so users are not repeatedly forced to re-authenticate.

### 2.2 Customer App (CUST)

**Ordering & discovery**
- **FR-CUST-001** — The system shall present a unified home screen with switchable verticals (Food, Grocery, Parcel/Send, and future verticals) under one session and one cart context.
- **FR-CUST-002** — The system shall let customers browse merchants/restaurants by category, distance, rating, and estimated delivery time.
- **FR-CUST-003** — The system shall support search with autocomplete across merchants, dishes, and products.
- **FR-CUST-004** — The system shall support an AI-assisted cart builder: a customer describes a meal, occasion, or shopping list in natural language and the system proposes a matching cart.
- **FR-CUST-005** — The system shall allow customers to save favorite orders and reorder in a single tap.
- **FR-CUST-006** — The system shall support scheduled orders (place now, deliver at a chosen future time).
- **FR-CUST-007** — The system shall support group ordering with a shareable link, where multiple participants add items to one shared cart before checkout.

**Cart, checkout, and payment**
- **FR-CUST-010** — The system shall support MTN Mobile Money, Airtel Money, card, and cash-on-delivery as payment methods, selectable at checkout.
- **FR-CUST-011** — The system shall display a full price breakdown before payment: subtotal, delivery fee, service fee, and any applicable discount.
- **FR-CUST-012** — The system shall support promo codes and first-order discounts applied at checkout.
- **FR-CUST-013** — The system shall support an in-app wallet that can hold balance from refunds, cashback, or top-ups, usable as a payment method.

**Addresses & location**
- **FR-CUST-020** — The system shall support pin-drop address selection on a map as the primary addressing method, with an optional free-text landmark description, given inconsistent formal street addressing in Kigali.
- **FR-CUST-021** — The system shall allow customers to save multiple named addresses (home, work, other).
- **FR-CUST-022** — The system shall detect and suggest the customer's current location on order placement, with manual override.

**Order tracking & communication**
- **FR-CUST-030** — The system shall provide live map tracking of the assigned driver from acceptance through delivery.
- **FR-CUST-031** — The system shall show a dynamically updated ETA that adjusts based on live driver location and traffic conditions.
- **FR-CUST-032** — The system shall provide in-app chat between customer and driver, with phone-number masking on both sides.
- **FR-CUST-033** — The system shall send order-status notifications via push notification and SMS (SMS as fallback for low-connectivity moments).
- **FR-CUST-034** — The system shall allow a customer to report an order issue (missing item, wrong item, late delivery, damaged parcel) directly from the order screen, routed to support.

**Post-order**
- **FR-CUST-040** — The system shall prompt customers to rate the driver and the merchant separately after order completion.
- **FR-CUST-041** — The system shall maintain an order history with reorder, receipt view, and support-ticket linkage per order.
- **FR-CUST-042** — The system shall support a subscription tier that waives delivery fees below a defined order-count/spend threshold, billed monthly.

**Diaspora ordering**
- **FR-CUST-050** — The system shall allow a user without a Rwandan SIM to create an account (via email or international phone number) and place/pay for an order to be delivered to a recipient in Rwanda.

### 2.3 Driver/Courier App (DRV)

- **FR-DRV-001** — The system shall present job offers across all verticals (food, grocery, parcel) to a single driver identity, filtered by the driver's active vehicle type and current availability toggle.
- **FR-DRV-002** — The system shall provide turn-by-turn navigation from the driver's current location to pickup, then to drop-off.
- **FR-DRV-003** — The system shall support batched/multi-stop assignments during high-demand periods, sequenced for route efficiency.
- **FR-DRV-004** — The system shall allow a driver to accept, decline, or (within policy limits) cancel a job, with reasons logged for performance tracking.
- **FR-DRV-005** — The system shall provide a real-time and historical earnings dashboard, broken down by job type and time period.
- **FR-DRV-006** — The system shall support scheduled payouts via Mobile Money on a defined cadence (e.g., daily or weekly), plus on-demand instant payout where feasible.
- **FR-DRV-007** — The system shall track and reconcile cash collected on cash-on-delivery jobs against the driver's account.
- **FR-DRV-008** — The system shall include an in-app SOS/emergency button that alerts ops and shares live location.
- **FR-DRV-009** — The system shall record trip data (route taken, timestamps, distance) for dispute resolution and safety review.
- **FR-DRV-010** — The system shall show drivers incentive zones or bonus prompts during under-supplied periods, without altering the price the customer sees.
- **FR-DRV-011** — The system shall support a driver rating and standing system, with clear thresholds and an appeals path before deactivation.

### 2.4 Merchant Platform (MER)

- **FR-MER-001** — The system shall let merchants create and manage a digital menu/catalog with items, prices, photos, descriptions, and modifiers (e.g., size, add-ons).
- **FR-MER-002** — The system shall let merchants toggle item or full-store availability in real time (e.g., "sold out," "closed for the day").
- **FR-MER-003** — The system shall route incoming orders to a merchant order queue with accept/reject and a prep-time estimate input, which feeds the customer-facing ETA.
- **FR-MER-004** — The system shall provide merchants a sales dashboard: order volume, revenue, top items, and peak hours.
- **FR-MER-005** — The system shall provide a payout and commission statement per settlement period, downloadable as a report.
- **FR-MER-006** — The system shall let merchants create time-boxed promotions or discounts on selected items.
- **FR-MER-007** — The system shall support printable or tablet-based order-ticket views for kitchens without a dedicated POS integration.
- **FR-MER-008** — The system shall (in later phase) support featured-placement and in-app advertising slots purchasable by merchants.

### 2.5 Admin & Operations (ADM)

- **FR-ADM-001** — The system shall provide a live city-wide dispatch map showing active drivers, active orders, and current demand density by zone.
- **FR-ADM-002** — The system shall provide a demand-forecasting view by zone and time window, using historical order data as a baseline.
- **FR-ADM-003** — The system shall allow ops to manually reassign or cancel an order/job in exceptional cases, with an audit trail.
- **FR-ADM-004** — The system shall provide a merchant and driver onboarding queue with document review and approval/rejection actions.
- **FR-ADM-005** — The system shall provide a support ticketing interface with categorization, priority, and SLA-tracking per ticket.
- **FR-ADM-006** — The system shall provide a fraud/abuse review queue flagging suspicious patterns (GPS spoofing, order manipulation, repeated refund abuse) for manual review.
- **FR-ADM-007** — The system shall provide financial reconciliation views reconciling Mobile Money settlements, merchant payouts, and driver payouts against order records.
- **FR-ADM-008** — The system shall support city/zone-level configuration (delivery radius, fee structure, active verticals) so new cities can be enabled without a code deployment.

### 2.6 Payments & Wallet (PAY)

- **FR-PAY-001** — The system shall integrate directly with MTN Mobile Money and Airtel Money APIs for both collection (customer payment) and disbursement (driver/merchant payout).
- **FR-PAY-002** — The system shall support card payments via a licensed payment gateway supporting Rwandan and regional cards.
- **FR-PAY-003** — The system shall maintain an internal ledger recording every transaction (order payment, commission deduction, refund, payout) with immutable audit history.
- **FR-PAY-004** — The system shall process refunds back to the original payment method or as wallet credit, per policy and support-agent action.
- **FR-PAY-005** — The system shall calculate and apply commission deductions automatically at the point of merchant/driver payout.
- **FR-PAY-006** — The system shall support multi-currency readiness in the ledger and pricing layer, even while operating single-currency (RWF) at launch, to avoid a rebuild for regional expansion.

### 2.7 Dispatch & Logistics Engine (DISP)

- **FR-DISP-001** — The system shall automatically match new orders to the nearest available and eligible driver based on proximity, vehicle type, and current load.
- **FR-DISP-002** — The system shall recalculate optimal routes and ETAs continuously based on live driver GPS position.
- **FR-DISP-003** — The system shall support order batching logic that groups compatible nearby orders for a single driver when it reduces total delivery time.
- **FR-DISP-004** — The system shall escalate an unmatched order to a wider driver radius or to ops attention if no driver accepts within a defined time window.
- **FR-DISP-005** — The system shall log every dispatch decision (offer, accept, decline, timeout) for later analysis and algorithm tuning.

### 2.8 Notifications (NOTIF)

- **FR-NOTIF-001** — The system shall send push notifications for order status changes (confirmed, preparing, picked up, arriving, delivered).
- **FR-NOTIF-002** — The system shall send SMS notifications as a fallback channel for critical status updates when push delivery cannot be confirmed.
- **FR-NOTIF-003** — The system shall support a USSD-based order-status check for customers without a data connection at the moment of checking.
- **FR-NOTIF-004** — The system shall allow customers, drivers, and merchants to configure notification preferences (push, SMS, both) per category.

### 2.9 Trust & Safety (TRUST)

- **FR-TRUST-001** — The system shall require identity verification (national ID or passport match, selfie liveness check) for all drivers before activation.
- **FR-TRUST-002** — The system shall display driver name, photo, vehicle details, and rating to the customer before and during a trip/delivery.
- **FR-TRUST-003** — The system shall support an order-accuracy guarantee workflow: customer reports issue, system auto-approves refund/credit under a defined threshold, escalates above it.
- **FR-TRUST-004** — The system shall show transparent, distance-based pricing before checkout with no undisclosed surge multiplier, consistent with the trust positioning this market responds to.
- **FR-TRUST-005** — The system shall log and retain trip data for a defined retention period to support safety investigations and disputes.

### 2.10 Growth & Retention (GROW)

- **FR-GROW-001** — The system shall support a two-sided referral program (customer-refers-customer, driver-refers-driver) with trackable codes and automatic reward issuance.
- **FR-GROW-002** — The system shall support push/SMS-based re-engagement campaigns targeted by user segment (e.g., lapsed users, high-frequency users).
- **FR-GROW-003** — The system shall support loyalty points accrual and redemption tied to order activity.
- **FR-GROW-004** — The system shall support multi-language UI (Kinyarwanda, English, French at minimum) with language selectable at onboarding and changeable in settings.

### 2.11 Future-Phase / Platform Expansion (EXP)

- **FR-EXP-001** — The system architecture shall support adding new service verticals (pharmacy, dark-store grocery, bill payments, airtime top-up) without restructuring the core order, payment, or dispatch models.
- **FR-EXP-002** — The system shall support a B2B logistics interface allowing external businesses to submit delivery jobs via API against the existing driver network.
- **FR-EXP-003** — The system shall support multi-city configuration and, later, multi-country configuration (currency, language, tax rules) as isolated deployable configuration rather than forked code.

---

## 3. Non-Functional Requirements

### 3.1 Performance

- **NFR-PERF-001** — 95th-percentile API response time shall remain under 500ms for core read operations (menu browse, order status) under normal load.
- **NFR-PERF-002** — Live driver-location updates shall propagate to the customer app within 3 seconds of the driver's device reporting position.
- **NFR-PERF-003** — The dispatch engine shall return a driver match (or a "no match" escalation) within 15 seconds of order confirmation under normal supply conditions.
- **NFR-PERF-004** — The app shall render the home screen and menu views within 2 seconds on a mid-range Android device on a 3G connection, given the realistic device and network mix in this market.

### 3.2 Scalability

- **NFR-SCALE-001** — The system architecture shall be horizontally scalable at the service level so order volume growth does not require re-architecture, only added capacity.
- **NFR-SCALE-002** — The system shall be designed to handle at least 10x current peak order volume without degradation, validated through periodic load testing as the platform grows.
- **NFR-SCALE-003** — The database layer shall support read-replica scaling for reporting and analytics queries without impacting live transactional performance.

### 3.3 Availability & Reliability

- **NFR-AVAIL-001** — Core ordering and dispatch services shall target 99.9% uptime, excluding scheduled maintenance windows communicated in advance.
- **NFR-AVAIL-002** — The system shall degrade gracefully: if the AI cart-builder or a non-critical feature is unavailable, standard browsing and ordering shall remain fully functional.
- **NFR-AVAIL-003** — Payment and payout processing shall include automatic retry logic with idempotency guarantees, so a network failure never results in a duplicate charge or a lost payout.

### 3.4 Security

- **NFR-SEC-001** — All data in transit shall be encrypted via TLS 1.2 or higher; sensitive data at rest (payment identifiers, national ID numbers) shall be encrypted at the database level.
- **NFR-SEC-002** — The system shall never store raw card numbers; card processing shall be tokenized through the payment gateway's PCI-DSS-compliant infrastructure.
- **NFR-SEC-003** — Internal admin access shall require multi-factor authentication and be scoped by role, with all sensitive actions (refund approval, account suspension, payout override) logged with actor identity and timestamp.
- **NFR-SEC-004** — The system shall implement rate limiting and anomaly detection on authentication endpoints to prevent account takeover and OTP-abuse attacks.
- **NFR-SEC-005** — GPS spoofing and location-manipulation attempts on the driver app shall be detected and flagged for review rather than silently trusted.

### 3.5 Privacy & Compliance

- **NFR-COMP-001** — The system shall comply with Rwanda's data protection law (Law No. 058/2021 on the Protection of Personal Data and Privacy) for all personal data collection, storage, and processing.
- **NFR-COMP-002** — The system shall provide users a mechanism to request access to, correction of, or deletion of their personal data, consistent with data-subject rights.
- **NFR-COMP-003** — Payment processing shall comply with the operational and reporting requirements of the National Bank of Rwanda (BNR) as applicable to the payment integration model chosen.
- **NFR-COMP-004** — The system shall retain financial and trip records for the minimum period required by Rwandan tax and commercial law, and no longer than necessary beyond that for legitimate business use.

### 3.6 Usability & Accessibility

- **NFR-USA-001** — Core ordering flows (browse, cart, checkout) shall be completable in 4 taps or fewer from app open for a returning customer with a saved address and payment method.
- **NFR-USA-002** — The interface shall meet basic accessibility standards: sufficient color contrast, scalable text, and screen-reader-compatible labels on interactive elements.
- **NFR-USA-003** — The app shall remain usable on low-end Android devices (2GB RAM class) without crashing or becoming unresponsive.
- **NFR-USA-004** — Error states (payment failure, no drivers available, connection lost) shall present clear, actionable, non-technical messaging rather than raw error codes.

### 3.7 Localization

- **NFR-LOC-001** — All customer-, driver-, and merchant-facing text shall be fully translatable, with Kinyarwanda, English, and French as launch languages, managed through a central translation resource rather than hardcoded strings.
- **NFR-LOC-002** — Date, time, currency, and number formatting shall follow locale conventions per selected language/region.

### 3.8 Observability & Monitoring

- **NFR-OBS-001** — The system shall emit structured logs and metrics for all critical flows (order placement, payment, dispatch, payout) to a centralized monitoring stack.
- **NFR-OBS-002** — The system shall provide real-time alerting on key operational thresholds (payment failure rate spike, dispatch match-rate drop, API error rate) to the on-call operations channel.
- **NFR-OBS-003** — The system shall support distributed tracing across services so a single order's full lifecycle (placed → matched → picked up → delivered → paid out) can be reconstructed for debugging and dispute resolution.

### 3.9 Maintainability & Architecture

- **NFR-MAINT-001** — The backend shall be built as modular services (order, dispatch, payment, identity, notification) with clear API boundaries, allowing independent development and deployment rather than one monolithic release train.
- **NFR-MAINT-002** — All external integrations (Mobile Money, SMS gateway, maps) shall be abstracted behind an internal interface layer, so a provider can be swapped without touching core business logic.
- **NFR-MAINT-003** — The codebase shall maintain automated test coverage on critical paths (payment, dispatch, order lifecycle) sufficient to catch regressions before release, not rely on manual QA alone.
- **NFR-MAINT-004** — Infrastructure shall be defined as code (not manually configured servers) to make environment recreation, disaster recovery, and multi-region expansion practical.

### 3.10 Cost Efficiency

- **NFR-COST-001** — Infrastructure costs shall scale roughly linearly with usage (pay-as-you-grow cloud services) rather than requiring large fixed capacity commitments at early stage.
- **NFR-COST-002** — Third-party integrations (SMS, maps, payment gateway) shall be selected and architected to allow cost renegotiation or provider switching as volume grows, avoiding lock-in at unfavorable early-stage rates.

### 3.11 Data & Analytics

- **NFR-DATA-001** — The system shall capture the data needed to eventually train demand-forecasting and route-optimization models (historical orders, timestamps, locations, weather correlation where available) from day one, even before those models are built.
- **NFR-DATA-002** — The system shall maintain a clean, queryable data warehouse layer separate from the live transactional database, so analytics and reporting never degrade production performance.

---

## 4. Notes on Sequencing

Not everything above ships at once. Treat this document as the full target state, not the MVP scope. The current phased roadmap is food + grocery first, then parcel, then wallet/fintech, then merchant ads and dark stores. Ride-hailing has been removed from this plan: delivery motos carry a fixed insulated box over the rear seat, which physically occupies the space a passenger would sit in, so the "one driver toggles between a delivery job and a ride job" efficiency case doesn't hold for the moto fleet this platform actually runs on. Rides may be revisited later as a separate service line with its own dedicated vehicles or drivers, not layered onto the existing delivery fleet.

Use this spec to make sure each phase's architecture doesn't foreclose the requirements that come later — for example, the multi-currency ledger (FR-PAY-006) and modular service architecture (NFR-MAINT-001) should be true from the first line of code, even though multi-country operation itself is a later-phase feature.
