# TaskFlow — Git Workflow & Commit Plan

A structured approach to building TaskFlow in version control: how to set up the repo, how to branch and commit, and the order in which changes should land. It follows the build phases in the SRS (Appendix 8.2).

---

## 1. Principles

- `main` is always green and always deployable.
- One branch per feature or FR, short-lived (ideally merged within 1–3 days).
- Every change to `main` goes through a pull request, even as a solo developer.
- Squash-merge so each PR becomes one clean commit on `main`.
- Commits are small, logical, and use Conventional Commit messages.
- A feature is not done until it has tests, including a cross-tenant isolation test.
- Never commit secrets. If one leaks, rotate it; deleting the file is not enough.

---

## 2. Repository Structure

```
taskflow-api/
├── .github/
│   ├── workflows/ci.yml
│   ├── pull_request_template.md
│   └── ISSUE_TEMPLATE/feature.md
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── config/            # env parsing (Zod), constants
│   ├── common/            # errors, error envelope, logger, request-id, pagination
│   ├── db/                # prisma client, tenant-scoping extension, RLS helpers
│   ├── auth/              # routes, controller, service, schemas
│   ├── orgs/              # members, invitations, ownership transfer
│   ├── projects/
│   ├── tasks/
│   ├── api-keys/
│   ├── webhooks/          # service, worker, signing, SSRF guard
│   ├── audit/
│   ├── middleware/        # authenticate, tenantContext, rateLimit, validate, authorize
│   ├── policies/          # RBAC permission matrix
│   ├── jobs/              # queue setup, worker entrypoint
│   ├── app.ts             # builds the Express app (no listen)
│   └── server.ts          # starts the server
├── tests/
│   ├── unit/
│   ├── integration/
│   └── helpers/           # factories, two-org fixture
├── docs/
│   ├── SRS_TaskFlow_MultiTenant_API.md
│   ├── GIT_WORKFLOW_TaskFlow.md
│   └── DECISIONS.md
├── docker-compose.yml
├── .env.example
├── .gitignore
├── .editorconfig
├── eslint.config.js
├── tsconfig.json
├── package.json
└── README.md
```

`app.ts` is separate from `server.ts` so Supertest can import the app without opening a port.

---

## 3. One-Time Setup

### 3.1 Create the repository
1. Create an empty repo on GitHub (no README, no license, so the first push is clean).
2. Locally:
   ```bash
   git init -b main
   git remote add origin git@github.com:<username>/taskflow-api.git
   ```

### 3.2 First files (before the first commit)
- `.gitignore`: `node_modules/`, `dist/`, `.env`, `coverage/`, `*.log`
- `.env.example`: variable names with placeholder values only
- `README.md`: a short stub
- `docs/SRS_TaskFlow_MultiTenant_API.md` and this file

### 3.3 GitHub settings
- **Branch protection on `main`:** require a pull request, require the CI status check to pass, block force-pushes, and block deletion.
- **Merge options:** enable squash merge only; disable merge commits and rebase merging.
- **Automatically delete head branches** after merge.
- Enable Dependabot alerts and secret scanning.

### 3.4 Issues and milestones
- Create one GitHub **milestone per phase** (Phase 1 – Skeleton, Phase 2 – Auth & Tenancy, ...).
- Create one **issue per FR** (e.g., `FR-5: Org Invitation`) and assign it to its milestone.

---

## 4. Branching Strategy

Trunk-based development with short-lived branches.

| Prefix | Use for | Example |
|---|---|---|
| `feat/` | New functionality | `feat/invitations` |
| `fix/` | Bug fixes | `fix/refresh-token-reuse` |
| `chore/` | Tooling, config, dependencies | `chore/ci-pipeline` |
| `docs/` | Documentation only | `docs/readme-architecture` |
| `test/` | Tests only | `test/cross-tenant-sweep` |
| `refactor/` | Behaviour-preserving restructuring | `refactor/policy-module` |

### Daily loop
```bash
git switch main && git pull
git switch -c feat/invitations
# work, commit often
git push -u origin feat/invitations
# open PR, wait for CI, squash-merge on GitHub
git switch main && git pull
git branch -d feat/invitations
```

If `main` moves while you work:
```bash
git fetch origin
git rebase origin/main      # only on branches you have not shared with others
```

---

## 5. Commit Message Convention

Format: `type(scope): short imperative summary`

**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`, `build`

**Scopes** (match the module): `auth`, `orgs`, `projects`, `tasks`, `api-keys`, `webhooks`, `audit`, `db`, `policies`, `rate-limit`, `config`, `common`, `ci`

**Rules**
- Imperative mood: "add", not "added" or "adds".
- Summary under about 72 characters, no trailing period.
- Add a body when the *why* is not obvious.
- Reference the issue in the PR (`Closes #12`) rather than in every commit.
- One logical change per commit.

**Examples**
```
feat(auth): add refresh token rotation with reuse detection
feat(db): add tenant-scoping prisma extension
test(tenancy): add cross-tenant read/write isolation suite
fix(webhooks): reject redirects during delivery
ci: run integration tests against postgres and redis services
docs(srs): clarify api key permissions
```

**Breaking changes** (rare, but if an API contract changes): add `!` and a footer.
```
feat(tasks)!: rename status value `in-progress` to `in_progress`

BREAKING CHANGE: clients must send `in_progress`.
```

---

## 6. Pull Request Process

### 6.1 Before opening a PR
- [ ] Code compiles (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Tests pass (`npm test`)
- [ ] You have read your own diff

### 6.2 PR template (`.github/pull_request_template.md`)
```markdown
## What
<!-- One or two sentences -->

## Why
Closes #

## Checklist
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Cross-tenant isolation test added (if the feature touches tenant data)
- [ ] Permission matrix / policy module updated (if permissions changed)
- [ ] Prisma migration included (if schema changed)
- [ ] OpenAPI spec updated
- [ ] Audit log / webhook events wired in (if applicable)
- [ ] No secrets or `.env` committed
```

### 6.3 Merging
- Wait for CI to pass.
- **Squash and merge**, and edit the squash message so it follows the commit convention.
- The branch is deleted automatically.

---

## 7. Commit & PR Order

Phase 1 steps 1–2 go directly to `main` as the bootstrap (branch protection is enabled right after). Everything else goes through a PR.

### Phase 1 — Skeleton (`v0.1.0`)

| # | Commit / PR | Notes |
|---|---|---|
| 1 | `chore: initial commit with gitignore, readme stub, and docs` | Direct to `main` |
| 2 | `chore: add typescript, eslint, prettier, and package scripts` | Direct to `main`, then enable branch protection |
| 3 | `chore: add docker-compose for postgres and redis, plus .env.example` | |
| 4 | `feat(config): add zod-validated env config` | |
| 5 | `feat(common): add logger, request id, and error envelope` | |
| 6 | `feat: add app/server entrypoints with /health and /ready` | |
| 7 | `feat(db): add prisma schema for org, user, membership with first migration` | |
| 8 | `ci: add github actions workflow for lint, typecheck, and tests` | Protect `main` with this check |

**Demo:** app boots, `/health` responds, migrations run, CI is green.

### Phase 2 — Auth & Tenancy Core (`v0.2.0`)

| # | Commit / PR | FR |
|---|---|---|
| 9 | `feat(auth): add signup creating user, org, and owner membership` | FR-1 |
| 10 | `feat(auth): add login with access jwt and refresh token` | FR-2 |
| 11 | `feat(auth): add refresh rotation, reuse detection, and logout` | FR-3 |
| 12 | `feat(middleware): add authenticate and tenant-context middleware` | |
| 13 | `feat(db): add tenant-scoping prisma extension` | |
| 14 | `feat(db): add postgres RLS policies with per-request org setting` | |
| 15 | `feat(policies): add rbac permission matrix with unit tests` | §3.8 |
| 16 | `test: add two-org fixture and first isolation tests` | |
| 17 | `feat(auth): add password reset flow` | FR-4 (optional) |

**Demo:** signup, login, refresh; a test proving org B cannot read org A's data.

### Phase 3 — Members (`v0.3.0`)

| # | Commit / PR | FR |
|---|---|---|
| 18 | `feat(orgs): add invitations (create, list, revoke)` | FR-5 |
| 19 | `feat(auth): accept invitation for new and existing users` | FR-5 |
| 20 | `feat(orgs): add member list, role change, and removal` | FR-6 |
| 21 | `feat(orgs): add ownership transfer` | FR-7 |

**Demo:** invite, accept, change role, remove, transfer ownership.

### Phase 4 — Projects & Tasks (`v0.4.0`)

| # | Commit / PR | FR |
|---|---|---|
| 22 | `feat(common): add cursor pagination helper` | |
| 23 | `feat(projects): add project create, read, update` | FR-8, 9, 10 |
| 24 | `feat(projects): add project delete with cascade` | FR-11 |
| 25 | `feat(tasks): add task crud with composite tenant FK` | FR-12 |
| 26 | `feat(tasks): add status transition validation` | FR-13 |
| 27 | `feat(tasks): add assignment with same-org validation` | FR-14 |
| 28 | `feat(tasks): add status and assignee filters` | FR-12 |

### Phase 5 — Audit & Isolation (`v0.5.0`)

| # | Commit / PR | FR |
|---|---|---|
| 29 | `feat(audit): add audit log service and table` | FR-23 |
| 30 | `feat(audit): wire audit logging into member, project, and key actions` | FR-23 |
| 31 | `feat(audit): add audit log endpoint with filters` | FR-24 |
| 32 | `test: add cross-tenant sweep across all endpoints` | §5.1 |

### Phase 6 — API Keys (`v0.6.0`)

| # | Commit / PR | FR |
|---|---|---|
| 33 | `feat(api-keys): add key generation with hashed storage` | FR-15 |
| 34 | `feat(api-keys): add list and revoke` | FR-16 |
| 35 | `feat(auth): add api key authentication and scope enforcement` | FR-17 |

### Phase 7 — Rate Limiting (`v0.7.0`)

| # | Commit / PR | FR |
|---|---|---|
| 36 | `feat(rate-limit): add redis sliding-window limiter` | FR-22 |
| 37 | `feat(rate-limit): apply per-org, per-credential, and per-ip limits` | FR-22 |
| 38 | `feat(rate-limit): add rate limit headers and 429 handling` | FR-22 |

### Phase 8 — Webhooks (`v0.8.0`)

| # | Commit / PR | FR |
|---|---|---|
| 39 | `feat(webhooks): add webhook crud with ssrf validation` | FR-18 |
| 40 | `feat(jobs): add queue and worker setup` | FR-19 |
| 41 | `feat(webhooks): add signed delivery with retries and backoff` | FR-19, 20 |
| 42 | `feat(webhooks): add delivery log and auto-disable` | FR-21 |
| 43 | `feat(webhooks): emit events from project, task, and member services` | FR-19 |

### Phase 9 — Docs & Polish (`v1.0.0`)

| # | Commit / PR |
|---|---|
| 44 | `docs: generate openapi spec and serve swagger ui` |
| 45 | `feat: add seed script with two demo orgs` |
| 46 | `docs: add postman collection` |
| 47 | `docs: write readme with architecture, quick start, and design highlights` |

After Phase 9, the DevOps wrap (SRS §7) follows in its own PRs: `build: add production dockerfile`, `ci: add image build`, `ci: add cd pipeline`, `chore(infra): add terraform`, and so on.

---

## 8. Rules for Schema Migrations

- Include the migration in the **same PR** as the feature that needs it.
- Commit the generated `prisma/migrations/` folder.
- Never edit a migration after it has merged; add a new one instead.
- RLS policies and composite foreign keys go in migration SQL, so review that SQL by hand.

---

## 9. Tags and Releases

Tag at the end of each phase:
```bash
git switch main && git pull
git tag -a v0.2.0 -m "Phase 2: auth and tenancy core"
git push origin v0.2.0
```
Optionally create a GitHub Release for each tag with a short changelog (the squashed commit messages make this easy).

---

## 10. Fixing Mistakes

| Situation | Fix |
|---|---|
| Typo in the last commit, not pushed | `git commit --amend` |
| Wrong branch, uncommitted work | `git stash`, switch branch, `git stash pop` |
| Committed to `main` by mistake (not pushed) | `git branch feat/x && git reset --hard origin/main`, then continue on `feat/x` |
| Bad change already merged | `git revert <sha>` in a new PR |
| Secret committed | Rotate the secret immediately; then remove it from history if needed |
| Messy history on your own feature branch | `git rebase -i origin/main` before opening the PR |

Avoid `git push --force` except on your own unshared feature branch (use `--force-with-lease`).

---

## 11. Quick Reference

```bash
git status                         # what changed
git add -p                         # stage in logical chunks
git commit -m "feat(scope): ..."   # commit
git push -u origin <branch>        # first push of a branch
git fetch && git rebase origin/main
git log --oneline --graph -20      # sanity check history
```
