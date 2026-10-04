---
name: tenantry-pro
description: Sets up Tenantry Pro, the paid add-on to Tenantry Core. Use only when the project references Tenantry.Pro, or the user asks about Tenantry Pro, a schema per tenant, mixed isolation (some tenants on their own database or schema, others shared) or a Tenantry licence key.
license: Apache-2.0
compatibility: Tenantry Pro 0.7 with Tenantry Core 0.7, .NET 8, 9 or 10. Needs a Tenantry Pro subscription.
metadata:
  tenantry-version: "0.7"
---

# Tenantry Pro

Tenantry Pro is a paid package. It needs a subscription, which gives access to a private package feed and a licence
key; without a valid key, an application that calls `UsePro` does not start (`LicenseRequiredException`). Tell the user
this before suggesting it, and do not add Pro packages, the feed or a key to a project until the user confirms they
have a subscription. Everything in Tenantry Core (shared database isolation, a database per tenant, resolution, access
control, worker scopes) is free and needs no Pro.

Pro runs inside the Core registration: keep `AddTenantry`, the resolvers and the store, and add `tenant.UsePro(...)`.

## When Pro applies

| The user needs | Core alone | With Pro | Reference |
|----------------|------------|----------|-----------|
| A schema per tenant in one database (SQL Server, PostgreSQL) | No | `pro.UseSchemaPerTenant(...)` | [schema-per-tenant.md](references/schema-per-tenant.md) |
| Some tenants on their own database or schema, others shared | No | `pro.UseMixedMode(...)` | [mixed-mode.md](references/mixed-mode.md) |
| Create, migrate and seed a new tenant's database or schema in one call; remove a tenant's data | By hand | `ITenantProvisioner<TKey>`, `ITenantDeprovisioner<TKey>` | [lifecycle.md](references/lifecycle.md) |
| Migrate every tenant database as a deployment step, with exit codes and per-tenant failures | A loop of `MigrateAsync` | `dotnet run -- migrate-tenants` | [migrations.md](references/migrations.md) |
| The tenant carried into Hangfire or Quartz.NET jobs, or MassTransit or Rebus messages | Put the id in the job and use `RunInScopeAsync` | `pro.AddHangfirePropagation()` and the others | [background-jobs.md](references/background-jobs.md) |
| A job that runs once for every tenant, or periodically | A loop over `ITenantLookup<TKey>` | `TenantBackgroundService<TKey>`, `PeriodicTenantBackgroundService<TKey>` | [background-jobs.md](references/background-jobs.md) |
| An audit log of every insert, update and delete, with the tenant | No | `pro.AddAuditLogging(...)` | [audit-logging.md](references/audit-logging.md) |
| Connection strings read from a secrets store, cached per tenant | Wrap the provider yourself | `pro.CacheConnectionStrings()` | [connection-string-caching.md](references/connection-string-caching.md) |
| Health checks for every tenant database | No | `Tenantry.Pro.EfCore` health checks | https://tenantry.dev/docs/pro/health-checks |

## Install

Installing Pro needs the subscription's feed credentials and licence key: follow
[references/installation.md](references/installation.md). In short: a committed `nuget.config` that maps
`Tenantry.Pro` and `Tenantry.Pro.*` to the private GitHub Packages feed, two environment variables for the feed
credentials (`TENANTRY_GITHUB_USERNAME`, `TENANTRY_GITHUB_PAT`), and the licence key in the `Tenantry:License`
setting, kept out of source control. Never write the token or the key into a committed file.

## Steps for any Pro feature

1. Confirm the subscription, then set up the feed and the key as in the installation reference.
2. Add the packages the feature needs (`Tenantry.Pro`, plus `Tenantry.Pro.EfCore` for schemas, provisioning, migrations
   and audit, or the integration package for a job or message library).
3. Add `tenant.UsePro(pro => ...)` to the existing `AddTenantry` call, with the feature's registration from its
   reference. Methods that take a context type (`AddDatabaseProvisioning<TContext>()`, `AddSchemaProvisioning<TContext>()`,
   `AddMigrations<TContext>()`) return the builder without its key type, so call them last in a chain.
4. Build and start the app: a missing or invalid key, or a registration Pro cannot use, stops it at startup with a
   message naming the problem.
5. Test the feature as the reference describes. Tests that start the host need the key too: set `Tenantry__License`
   from a CI secret (https://tenantry.dev/docs/pro/testing).

## Further reading

- Pro getting started: https://tenantry.dev/docs/pro/getting-started
- Installation: https://tenantry.dev/docs/pro/installation
- Licensing: https://tenantry.dev/docs/pro/licensing
- Troubleshooting: https://tenantry.dev/docs/pro/troubleshooting
