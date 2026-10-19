# LOTTO

LOTTO is the CSS326 Group 8 project: a lottery website with simulated payments.

The project has one monthly draw on the last day at 18:00 Thailand time. Sales
close at 17:00. Each checkout covers one draw and up to 100 ticket copies.

Store one million number-inventory rows per draw with five available copies
each. Create an individual ticket record only when a copy is purchased. Do not
pre-create five million tickets or store TotalQuantity.

**Current stage: planning. The application code is not implemented yet.**

Use HTML, CSS and JavaScript for the frontend, Node.js/Express for the backend,
and MySQL 8 with `mysql2/promise` for the database.

## Project guides

1. [01 - Project overview and requirements](docs/01-requirements.md), including
   the [confirmed decisions](docs/01-requirements.md#confirmed-decisions).
2. [02 - Folder guide](docs/02-architecture.md), showing where to put the code.
3. [03 - API notes](docs/03-api-contract.md), explaining how to connect the frontend and backend.
4. [04 - Team GitHub guide](docs/04-github-guide.md), with practical steps for
   cloning, branches, commits, pushes, PRs and updating after a merge.

The supporting notes cover the [backend task split](docs/backend-allocation.md),
[test checklist](docs/security-and-tests.md) and
[optional draw verification](docs/draw-transparency.md).

## Folders

```text
frontend/              HTML, CSS and browser JavaScript
backend/
  routes/              API URLs and middleware
  controllers/         Request handling and feature logic
  middleware/          Login, role checks and error handling
database/              SQL tables, procedures, triggers and sample data
docs/                  Project explanation, task lists and API notes
```

Start with routes and controllers like the labs. Add helpers only when needed.
A frontend framework or complicated build setup is not needed.

## Team

| Person | Main work |
| --- | --- |
| Me | Express setup, authentication, checkout, profiles/dashboard and GitHub coordination |
| Backend teammate | MySQL setup, draws, inventory, tickets/history, results and shared testing |
| Frontend teammates | Split frontend tasks and connect pages to the APIs |

## Working together

- Work on feature branches, such as `feature/login` or `feature/draws`.
- Open pull requests to `main` and request my review.
- **I am the only approver for my teammates' PRs into `main`**, for frontend and backend.
- Wait for my approval before merging. Teammates can test and comment,
  but their reviews do not replace my approval.
- Keep commits small, with messages like `Add customer login`.
- Discuss shared API or database changes before editing them.
- Never commit `.env`, passwords, private draw secrets or `node_modules`.

For my own PRs, I check the work and make the final merge decision. GitHub does
not let authors approve their own PRs; if required reviews block my PR, my account
needs an allowed owner/admin bypass. This is documented in
[GitHub's review rules](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews).
These are team rules; GitHub protection settings have not been configured here.

## Local setup

There is no `package.json` or server yet. I will add installation/start
commands with the first backend code. Copy `.env.example` to `.env` and fill in
local values. Use a separate local database and fake accounts.

Build login, draws, checkout and history first. Add optional transparent drawing
after the core flow works.
