---
name: tenantry-new-app
description: Creates a new multi-tenant ASP.NET Core API or .NET worker with Tenantry and EF Core from the start. Use when starting a new SaaS backend or tenant-aware .NET service, or asked for a Tenantry starter.
license: Apache-2.0
compatibility: .NET 8, 9 or 10 with the EF Core major of the target framework. Tenantry 0.8 or later.
metadata:
  tenantry-version: "0.8"
---

# A new app with Tenantry

These instructions are for Tenantry 0.8 and later. After adding the packages, check with `dotnet list package`
that they are 0.8 or later, never 0.7 or earlier: 0.7 and earlier have isolation gaps that 0.8 fixes, and some names
used here do not exist in them. What changed: https://github.com/tenantry-org/tenantry-core/blob/master/CHANGELOG.md

Decide these with the user before writing code, and keep the answers in the README you write for the app:

1. Web API, worker, or both in one host (one `AddTenantry` serves both).
2. The tenant key type: `Guid`, `int`, `long` or `string`. Use it everywhere.
3. How a request names its tenant and how the caller proves it belongs to it (for an API).
4. Where tenants are listed: a fixed list to start (`UseInMemoryStore`) or a table.
5. One shared database (this skill) or a database per tenant (the `tenantry-database-per-tenant` skill).

## Steps

1. Create the project. With the .NET 10 SDK, start from one of Tenantry's templates:

   ```bash
   dotnet new install Tenantry.Templates::0.8.0
   dotnet new tenantry-api -n MyApp -o src/MyApp      # or: dotnet new tenantry-worker -n MyApp -o src/MyApp
   ```

   `tenantry-api` is an ASP.NET Core API with EF Core: callers authenticate with a JWT bearer token and name the tenant
   in the `X-Tenant-Id` header, which Tenantry checks against the token's `tenant_id` claims. `tenantry-worker` is a
   worker service with EF Core that runs each message as the tenant it names, with `RunInScopeAsync`. Both use `string`
   tenant ids, an in-memory store and SQLite, create the schema at startup and reference the Tenantry packages of the
   templates' version. Steps 2 to 5 then change what the template wrote to the answers above: the key type, the store,
   the provider, and a first migration in place of `EnsureCreatedAsync`. The template has no test project, so step 6
   still applies.

   The projects target `net10.0`. For .NET 8 or 9, or without the .NET 10 SDK, create the project and add the
   packages by hand:

   ```bash
   dotnet new webapi -o src/MyApp          # or: dotnet new worker -o src/MyApp
   cd src/MyApp
   dotnet add package Tenantry.AspNetCore --version 0.8.0  # API only
   dotnet add package Tenantry.EfCore --version 0.8.0
   dotnet add package Microsoft.EntityFrameworkCore.SqlServer   # or your provider
   ```

   A worker references `Tenantry.Core` and `Tenantry.EfCore` and no ASP.NET Core package.

   `::0.8.0` and `--version 0.8.0` make NuGet install 0.8.0 exactly. If either command cannot find 0.8.0
   (`dotnet add package` fails with NU1102), stop and tell the user. Do not install an older version, and do not remove
   the version. Once it succeeds, update every Tenantry package to the newest 0.8.x patch:
   `dotnet list package --outdated` lists it, and `dotnet add package <name> --version <that patch>` installs it.

2. Write the entities. Tenant-owned ones derive from `TenantEntity<TKey>` or implement `ITenantEntity<TKey>`; shared
   ones (reference data, the tenant registry) implement nothing. Lead composite indexes with `TenantId`, and make
   unique indexes unique per tenant.
3. Write a plain `DbContext` and register it with `.UseTenantry()` on its options.
4. Register Tenantry with the store, resolution and access validation chosen above, and add `app.UseTenantry()`
   after `app.UseAuthentication()`.
5. Add the first migration with `dotnet ef migrations add Initial`.
6. Add the isolation test.

[references/api.md](references/api.md) has a complete API: entities, context, registration, endpoints and the test
project. [references/worker.md](references/worker.md) has the worker version. Copy the one that fits, then rename the
types to the user's domain.

## Rules to keep from the start

- Never ship header, subdomain or route resolution without an access validator: any caller could choose any tenant.
- Mark every entity whose rows belong to a tenant, child rows included; unmarked entities are shared by design.
- Never set `TenantId` in application code; Tenantry stamps it on insert.
- Background work opens a tenant scope (`ITenantScopeFactory<TKey>.RunInScopeAsync(id, ...)`); see the
  `tenantry-non-http` skill.
- Raw SQL (`SqlQuery`, `ExecuteSql`) and `IgnoreQueryFilters()` are not isolated: add the tenant predicate yourself, and
  keep cross-tenant reads to admin code behind authorization.

## Verify

1. `dotnet build` has no warnings. Tenantry's analyzers (TNY1001 to TNY3002) report tenant mistakes at build time: fix
   what they report rather than suppress it, unless the code is meant to cross tenants
   (https://tenantry.dev/docs/core/analyzers).
2. `dotnet test` passes, including the isolation test.
3. With the app running, two tenants each see only their own data, a signed-in request with no tenant gets `400` (an
   anonymous one `401` on endpoints that require authorization), and a tenant the caller may not use gets `403`.

## Further reading

- Getting started: https://tenantry.dev/docs/core/getting-started
- Core concepts: https://tenantry.dev/docs/core/core-concepts
- The SecureApi sample, with JWT authentication and tests:
  https://github.com/tenantry-org/tenantry-core/tree/master/samples/Tenantry.Samples.SecureApi
