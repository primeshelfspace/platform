# Documentation

## Start here

| Document                                               | Read it to…                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [getting-started.md](getting-started.md)               | Install, set up and run everything on your machine                           |
| [developer-guide.md](developer-guide.md)               | How a request travels through the code, where things are, how to change them |
| [operations/production.md](operations/production.md)   | The live system: what runs where, access, deploys, everyday operations       |
| [architecture/README.md](architecture/README.md)       | Understand how the system is built                                           |
| [guides/payment-flow.md](guides/payment-flow.md)       | Click through invoice → payment and test each outcome                        |
| [guides/deploy-ec2.md](guides/deploy-ec2.md)           | Deploy everything to AWS: EC2, RDS, Redis, S3, SES, nginx                    |
| [api/README.md](api/README.md)                         | Call the APIs: addresses, sign-in, errors, money; every endpoint             |
| [security.md](security.md)                             | Every security rule, the October 2026 audit and its fixes, what is open      |
| [testing/user-scenarios.md](testing/user-scenarios.md) | Everything a user can do, and the test that proves each one                  |

## Architecture

| Document                                                                   | Covers                                                   |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| [architecture/README.md](architecture/README.md)                           | Overview, diagram, repository map                        |
| [architecture/principles.md](architecture/principles.md)                   | The rules that must not break (money, isolation, …)      |
| [architecture/modules.md](architecture/modules.md)                         | The three APIs, how they talk, boundary checks           |
| [architecture/layers.md](architecture/layers.md)                           | Clean-architecture layers inside a feature               |
| [architecture/databases.md](architecture/databases.md)                     | One database per API, roles, row-level security          |
| [architecture/events.md](architecture/events.md)                           | Outbox, delivery, published events                       |
| [architecture/products-and-access.md](architecture/products-and-access.md) | Subscriptions, roles per product, locations, one sign-in |
| [architecture/adding-a-product.md](architecture/adding-a-product.md)       | Bringing HQ (or any product) online                      |
| [architecture/decisions/](architecture/decisions/)                         | Why it is built this way (decision records)              |

## Integrations

| Document                                                                 | Covers                            |
| ------------------------------------------------------------------------ | --------------------------------- |
| [integrations/zoho-books.md](integrations/zoho-books.md)                 | Connecting and syncing Zoho Books |
| [integrations/zoho-books-sandbox.md](integrations/zoho-books-sandbox.md) | Testing against a Zoho sandbox    |

## Product

| Document                       | Covers                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| [product/](product/)           | Requirements, technical design, flows, MVP feature list (Word documents) |
| [known-gaps.md](known-gaps.md) | Open decisions and dependencies                                          |
