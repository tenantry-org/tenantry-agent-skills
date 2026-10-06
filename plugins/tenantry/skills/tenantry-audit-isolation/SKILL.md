---
name: tenantry-audit-isolation
description: Reviews a .NET app that already uses Tenantry for tenant isolation gaps and reports findings by file and line. Use when asked to audit, review or security-check a Tenantry app, or whether one tenant can see another's data.
license: Apache-2.0
compatibility: Tenantry 0.8 or later. Needs read access to the application's source.
metadata:
  tenantry-version: "0.8"
---

# Audit a Tenantry app for isolation gaps

The goal is a list of findings the user can act on, each tied to a file and line. Read the code; do not change it
unless the user asks. A finding is something that lets one tenant read or change another's data, lets a caller choose
a tenant it does not belong to, or makes tenant code run with the wrong tenant or none.

## Procedure

1. Map the app: projects, target frameworks, Tenantry package versions (`dotnet list package`), the `AddTenantry` call,
   every `DbContext` and its registrations, the request pipeline, hosted services and job or message handlers.
2. Run each check in [references/checks.md](references/checks.md), in order. Each check says what to search for, what
   is a finding and how severe it is. Record evidence as `path:line` with the line's code.
3. Build the app. Tenantry's analyzers report several of these checks as warnings or info: TNY1004 (a context with
   tenant-owned entities registered without `UseTenantry()`), TNY1001 (an entity with a `TenantId` that is not
   tenant-owned), TNY1002 (a query that reads a tenant-owned entity and ignores the tenant filter), TNY1003 (raw SQL),
   TNY2001 (a request resolver with no access validator), TNY3001 (`MakeCurrent` or `CreateScope` given a descriptor
   built in the call) and TNY3002 (blocking on `RunInScopeAsync`). Treat each as a lead, and look for suppressions of
   them (`#pragma warning disable TNY`, `SuppressMessage`, `.editorconfig` severities) that hide real findings.
4. For every search hit, read enough of the surrounding code to decide. A hit is not a finding until you have
   confirmed it; say "not a finding" and why for hits a reader might expect to be one.
5. If the app has tests, run them. Note whether an isolation test exists (one that writes as one tenant and reads as
   another); its absence is a finding.
6. Write the findings as described under [Writing the findings](#writing-the-findings), most severe first.

A Tenantry package at 0.6 or earlier is a finding of its own (High): 0.6 has isolation gaps that later releases fix
(https://github.com/tenantry-org/tenantry-core/blob/master/CHANGELOG.md). One at 0.7 is High when a request through
an HTTP or gRPC client with `UseTenantry()` can carry a `tenantry-tenant-id` header taken from the incoming request
(header propagation, or headers copied by hand): with no tenant current, 0.7 sends that header on, so the caller
chooses the tenant the other service acts for. 0.8 refuses such a request. Otherwise a 0.7 package is Low. These
checks are written for 0.8 and later: report the version, recommend the upgrade, and run the checks anyway.

## Severity

| Severity | Meaning |
|----------|---------|
| High | One tenant can read or change another's data, or a caller can act as a tenant it does not belong to |
| Medium | Isolation holds today but depends on something fragile (an unmarked child type reached only through a filtered parent, a missing unique-per-tenant index), or tenant work fails or runs with no tenant |
| Low | Hardening, test coverage and clarity: no current path to another tenant's data |

## What is shared by design

An entity type that does not implement `ITenantEntity<TKey>` is shared by every tenant. That is how Tenantry is meant
to be used: reference data, catalogues, the tenant registry and membership tables stay unmarked. Report an unmarked
type only when its rows belong to one tenant (it has an owner column, or it is a child of a tenant-owned type), and
ask the user about types you cannot classify rather than reporting them all.

## Writing the findings

Write them in Markdown, in the conversation or in a file the user names. Start with one line giving the commit or
date reviewed, the Tenantry version, and the number of contexts and of entity types (and how many are tenant-owned).
Then:

1. A table of findings with the columns `#`, `Severity`, `Where` (`path:line`), `Finding` and `Fix`, numbered by
   severity and then by file. For example: `1 | High | src/Api/Program.cs:42 | ResolveFromHeader("X-Tenant-Id") with
   no access validator: any caller can name any tenant | Add ValidateTenantAccessByClaim("tenant_id")`.
2. For each finding, a short section with the evidence (the line of code, quoted), why it matters in one or two
   sentences, and the smallest fix, with code when it is short.
3. "Checked and not a finding": hits a reader might expect to be findings, with the reason each is safe.
4. "Outside Tenantry": see below.
5. "Tests": whether an isolation test exists, whether it passes, and what it covers.

When a fix needs a decision from the user (which tenant owns existing rows, whether a type is shared), say so in the
Fix column instead of guessing.

## Out of scope

Tenantry isolates data inside EF Core and resolves tenants for requests. Files, blob storage paths, search indexes,
message topics and third-party APIs are outside it: list any you find under "Outside Tenantry" in the report, without
a severity, so the user can review them.

## Further reading

- What is and is not isolated: https://tenantry.dev/docs/core/efcore-integration#what-is-and-isnt-isolated
- Access control: https://tenantry.dev/docs/core/access-control
- Troubleshooting: https://tenantry.dev/docs/core/troubleshooting
