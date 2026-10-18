# Known gaps

Open items that are decisions or dependencies outside the code — not bugs.
Last checked against the code: October 2026.

| Item                                | Status                                                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Numbers Gateway (DEP-01)**        | The API contract could not be read, so `NumbersGatewayAdapter` is a typed placeholder listing the questions it needs answered. Use `PAYMENT_GATEWAY_DRIVER=fake` or `stripe`.                                                                                       |
| **Card fee base (Q-01)**            | The fee is calculated on the post-tax total (TDD-001 §9.2). Card surcharging is regulated in some US states. Both need a client answer before the fee ships.                                                                                                        |
| **Unit price precision**            | TDD-001 §9.3 writes a unit price with three decimals, which `unit_price_minor` cannot hold; the fixture carries the fraction on the quantity instead (same result). If fractional unit prices are a real requirement, the schema needs a four-decimal price column. |
| **Two-factor sign-in**              | `loginSchema` accepts a `totp` field and `user.totp_secret` exists, but nothing reads either yet.                                                                                                                                                                   |
| **Subscriptions, accounts app, HQ** | Next phases of the architecture plan — see [architecture/adding-a-product.md](architecture/adding-a-product.md).                                                                                                                                                    |
