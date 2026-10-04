---
name: tenantry-new-app
description: Creates a new multi-tenant .NET application with Tenantry from the start, either an ASP.NET Core API or a worker service, with EF Core isolation by a TenantId column in a shared database, tenant resolution, access validation and an isolation test. Use when the user starts a new SaaS backend, multi-tenant web API or tenant-aware background worker in .NET and wants tenant isolation built in, or asks for a Tenantry starter or template. For an app that already exists, use tenantry-add-to-existing-app.
license: Apache-2.0
compatibility: .NET 8, 9 or 10 with the EF Core major of the target framework. Written for Tenantry 0.7.
metadata:
  tenantry-version: "0.7"
---

# A new app with Tenantry

Decide these with the user before writing code, and keep the answers in the README you write for the app:

1. Web API, worker, or both in one host (one `AddTenantry` serves both).
2. The tenant key type: `Guid`, `int`, `long` or `string`. Use it everywhere.
3. How a request names its tenant and how the caller proves it belongs to it (for an API).
4. Where tenants are listed: a fixed list to start (`UseInMemoryStore`) or a table.
5. One shared database (this skill) or a database per tenant (the `tenantry-database-per-tenant` skill).

## Steps

1. Create the project and add the packages:

   ```bash
   dotnet new webapi -o src/MyApp          # or: dotnet new worker -o src/MyApp
   cd src/MyApp
   dotnet add package Tenantry.AspNetCore  # API only
   dotnet add package Tenantry.EfCore
   dotnet add package Microsoft.EntityFrameworkCore.SqlServer   # or your provider
   ```

   A worker references `Tenantry.Core` and `Tenantry.EfCore` and no ASP.NET Core package.

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

1. `dotnet build` has no warnings.
2. `dotnet test` passes, including the isolation test.
3. With the app running, two tenants each see only their own data, a request with no tenant gets `400`, and a tenant
   the caller may not use gets `403`.

## Further reading

- Getting started: https://tenantry.dev/docs/core/getting-started
- Core concepts: https://tenantry.dev/docs/core/core-concepts
- The SecureApi sample, with JWT authentication and tests:
  https://github.com/tenantry-org/tenantry-core/tree/master/samples/Tenantry.Samples.SecureApi
