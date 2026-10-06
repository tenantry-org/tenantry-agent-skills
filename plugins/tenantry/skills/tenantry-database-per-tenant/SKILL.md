---
name: tenantry-database-per-tenant
description: Gives each tenant its own database with Tenantry Core, connecting every EF Core DbContext to the current tenant's database. Use when the user wants a database or connection string per tenant in a .NET app.
license: Apache-2.0
compatibility: .NET 8, 9 or 10 with the EF Core major of the target framework. Tenantry 0.8 or later.
metadata:
  tenantry-version: "0.8"
---

# A database per tenant

Tenantry Core, the free packages, connects each context to the current tenant's database. You give it a way to find a
tenant's connection string (`UseConnectionStrings`) and register the context with `AddDbContextPerTenantDatabase`,
which sets the connection string whenever a context or a pooled lease is handed out.

The exact registration, its options and its rules are in one file,
[references/registration.md](references/registration.md). Read it before writing the registration. (It is kept in
one file because the registration may change in a later release.)

These instructions are for Tenantry 0.8 and later. If the project references Tenantry at 0.7 or earlier
(`dotnet list package`), upgrade every Tenantry package to 0.8 first: 0.7 and earlier have isolation gaps that 0.8
fixes. What changed: https://github.com/tenantry-org/tenantry-core/blob/master/CHANGELOG.md

## Steps

1. Inspect the app as for a shared database: the target framework and EF Core version, every `DbContext` and where it
   is registered, how requests name the tenant, and raw SQL. Note which contexts hold per-tenant data and which hold
   shared data (the tenant registry, reference data): only the per-tenant ones move to a database per tenant.
2. Install the packages with `dotnet add package <name> --version 0.8.0`: `Tenantry.EfCore`, plus `Tenantry.AspNetCore`
   in a web app (`Tenantry.Core` comes with them).

   `--version 0.8.0` makes NuGet install 0.8.0 exactly, the lowest version that satisfies it. If the command fails with
   NU1102, stop and tell the user. Do not install an older version, and do not remove `--version`. Once it succeeds,
   update every Tenantry package to the newest 0.8.x patch: `dotnet list package --outdated` lists it, and
   `dotnet add package <name> --version <that patch>` installs it.
3. Put what identifies each tenant's database on the tenant: a database name built from the id, or a connection
   string or secret name on your own descriptor type, read with `t.As<AppTenant>()`. Write the store as for a shared
   database, over the registry in the shared database
   (https://tenantry.dev/docs/core/tenant-stores).
4. Register `UseConnectionStrings` and `AddDbContextPerTenantDatabase` as in the reference, and remove the context's
   old `AddDbContext` (or pool or factory) registration. The registry's own context stays an ordinary
   `AddDbContext` against the shared database.
5. For a web app, add resolution and access validation as for a shared database (header, subdomain or claim, plus a
   validator), and `app.UseTenantry()` after `app.UseAuthentication()`.
6. Keep `ITenantEntity<TKey>` on the per-tenant entities if they have it. It is optional with a database per tenant,
   and a second check: a connection string that points at the wrong database then shows no rows and refuses writes.
7. Add a design-time factory for `dotnet ef`, generate migrations, and apply them to every tenant's database as a
   deployment step: [references/migrations.md](references/migrations.md).
8. Background work opens a tenant scope (`RunInScopeAsync(id, ...)`) exactly as with a shared database: see the
   `tenantry-non-http` skill.

## Verify

1. `dotnet build` has no new warnings. Tenantry's analyzers (TNY1001 to TNY3002) report tenant mistakes at build time:
   fix what they report rather than suppress it, unless the code is meant to cross tenants
   (https://tenantry.dev/docs/core/analyzers).
2. A test creates two tenants' databases (SQLite files, or containers of the real database) and checks that each
   tenant's context connects to its own and sees only its own rows. The Core sample does this with SQLite files:
   https://github.com/tenantry-org/tenantry-core/tree/master/samples/Tenantry.Samples.DatabasePerTenant
3. A context created with no tenant current throws `TenantNotResolvedException`.
4. The migration step migrates every tenant's database, and the app starts and serves two tenants from two databases.

## Things that are not covered

SQL run directly on `Database.GetDbConnection()` is not checked by the guard. A streaming or split query that started
before the tenant changed keeps reading from its database. Connection strings are read on every context creation
unless you cache them; Tenantry Pro, a paid package, adds `CacheConnectionStrings()`, provisioning and a migration
runner (see the `tenantry-pro` skill).

## Further reading

- Database per tenant: https://tenantry.dev/docs/core/efcore-integration#database-per-tenant
- Non-HTTP hosts: https://tenantry.dev/docs/core/non-http-hosts
