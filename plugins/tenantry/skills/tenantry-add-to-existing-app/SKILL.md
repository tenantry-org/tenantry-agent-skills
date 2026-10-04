---
name: tenantry-add-to-existing-app
description: Adds Tenantry multi-tenancy to an existing ASP.NET Core application that uses EF Core with one shared database, so every query and save is scoped to the current tenant by a TenantId column. Use when the user wants to make an existing .NET web app or API multi-tenant, keep each customer's, organisation's or account's data apart, add tenant isolation or a TenantId to EF Core entities, or install Tenantry.AspNetCore and Tenantry.EfCore in a project that already has a DbContext. For a new project use tenantry-new-app; for a database per tenant use tenantry-database-per-tenant; for workers and console apps use tenantry-non-http.
license: Apache-2.0
compatibility: .NET 8, 9 or 10 with the EF Core major of the target framework. Written for Tenantry 0.7.
metadata:
  tenantry-version: "0.7"
---

# Add Tenantry to an existing ASP.NET Core and EF Core app

Tenantry keeps each tenant's rows apart in a shared database. An entity that implements `ITenantEntity<TKey>` is
tenant-owned: `options.UseTenantry()` filters its queries to the current tenant and checks its saves. Every other
entity is shared by all tenants, and that is intended: reference data, catalogues and the tenant registry stay
unmarked. On each request, `app.UseTenantry()` resolves the tenant, checks the caller may use it, and makes it current.

Work through the steps in order. Do not skip the inspection or the test: they are how you and the user know the
change is complete. Explain each choice to the user in plain words before you make it.

## 1. Inspect the app before changing anything

Find and write down, with file paths:

- The target framework of each project (`<TargetFramework>`) and the EF Core packages and their versions. Tenantry
  needs .NET 8 or later, with the EF Core major that matches the target framework.
- Every `DbContext` (`: DbContext`, `: IdentityDbContext`) and every place one is registered or configured:
  `AddDbContext`, `AddDbContextPool`, `AddDbContextFactory`, `AddPooledDbContextFactory`, `OnConfiguring`, and any
  `IDesignTimeDbContextFactory`.
- Every entity type, and for each one whether its rows belong to one customer. Look for an existing owner column
  such as `OrganisationId`, `AccountId`, `CompanyId`, `CustomerId` or `TenantId`, and note its type.
- What identifies the customer on a request today: a claim in the token, a subdomain, a route segment, a header.
- The authentication setup (`AddAuthentication`, `AddJwtBearer`, cookies, Identity) and the claims it issues.
- Code that bypasses EF Core's filters: `SqlQuery`, `SqlQueryRaw`, `ExecuteSql`, `ExecuteSqlRaw`,
  `ExecuteSqlInterpolated`, `IgnoreQueryFilters`, `GetDbConnection`, Dapper calls, stored procedures.
- Background work: `BackgroundService`, `IHostedService`, Hangfire, Quartz, message consumers. These have no request
  and need a tenant scope; the `tenantry-non-http` skill covers them.

If which entities belong to a tenant, or which tenant owns the rows already in the database, is not clear from the
code, ask the user. Do not guess.

## 2. Choose the key type and install the packages

Use the type of the existing owner id as `TKey` (`Guid`, `int`, `long` or `string`), and use it everywhere. Check
the installed Tenantry version with `dotnet list package`: these instructions are for 0.7.

```bash
# In the web project
dotnet add package Tenantry.AspNetCore
dotnet add package Tenantry.EfCore
```

A separate project that holds only entities needs `Tenantry.Core` (for `ITenantEntity<TKey>`); one that calls
`UseTenantry()` on a context's options needs `Tenantry.EfCore`.

## 3. Choose where tenants are listed

Tenantry reads tenants from one `ITenantStore<TKey>`. If the app already has an organisations or accounts table, write
a store over it; otherwise start with `UseInMemoryStore`. See [references/tenant-store.md](references/tenant-store.md).
The registry entity must not implement `ITenantEntity<TKey>`.

## 4. Choose resolution and access validation

Pick how each request names its tenant, and how Tenantry checks the caller belongs to it, from
[references/resolution-and-access.md](references/resolution-and-access.md). A header or subdomain without an access
validator lets any caller choose any tenant: never ship that.

## 5. Register Tenantry and the middleware

```csharp
builder.Services.AddTenantry<Guid>(tenant => tenant
    .ResolveFromHeader("X-Tenant-Id")             // from step 4
    .UseStore<OrganisationTenantStore>()          // from step 3
    .RequireTenantByDefault()                     // every endpoint needs a tenant unless it opts out
    .ValidateTenantAccessByClaim("tenant_id"));   // the caller's claims must name the tenant
```

```csharp
app.UseAuthentication();
app.UseTenantry();        // after authentication, before authorization and the endpoints
app.UseAuthorization();
```

Mark endpoints that work without a tenant (health checks, sign-in, sign-up) with `.AllowMissingTenant()` or
`[AllowMissingTenant]`. `AddTenantry` and its builder methods need no `using`; `TenantDescriptor<TKey>` and
`ITenantEntity<TKey>` are in the `Tenantry` namespace.

## 6. Mark the tenant-owned entities

Implement `ITenantEntity<TKey>` (or derive from `TenantEntity<TKey>`) on every entity whose rows belong to one tenant,
including child rows such as order lines: an unmarked child is shared, so its set returns every tenant's rows. Leave
`TenantId` unset in your code; Tenantry stamps it on insert. Mapping an existing owner column, owned types, join
entities and indexes are in [references/entities-and-migrations.md](references/entities-and-migrations.md).

## 7. Call `UseTenantry()` on every context registration

```csharp
builder.Services.AddDbContext<AppDbContext>(options => options
    .UseSqlServer(connectionString)
    .UseTenantry());
```

Add it to every registration found in step 1, including factories and pooled contexts, after any `SaveChanges`
interceptors of your own. A context whose options do not call it is not isolated. The `DbContext` class itself needs
no base class, interface or override.

## 8. Add the migration

Run `dotnet ef migrations add AddTenantry` and read the generated file before applying it. A new `TenantId` column
gives existing rows a value that names no tenant, so they disappear from every tenant until you assign them. How to
backfill them, and what the migration should contain when the column already existed, is in
[references/entities-and-migrations.md](references/entities-and-migrations.md#the-migration).

## 9. Fix the code the change breaks

- Code that sets the owner id by hand: remove it, Tenantry stamps it.
- `db.Update(new Order { Id = id, ... })` built from a request body is refused, as the new instance has no tenant.
  Load the entity first, then change it.
- Admin and reporting code that reads across tenants: `IgnoreQueryFilters()` on those queries only, behind an
  authorization policy.
- Background work: open a tenant scope as described in `tenantry-non-http`.
- Raw SQL found in step 1: add the tenant predicate yourself
  ([references/not-isolated.md](references/not-isolated.md)).

## 10. Write the isolation test

Add the test in [references/isolation-test.md](references/isolation-test.md). It uses the app's own `DbContext` and
entities on SQLite in memory, and proves that a tenant reads only its rows, that a write naming another tenant is
refused, that nothing is read or written without a tenant, and that every unmarked entity type is one you meant to
share.

## 11. Verify

1. `dotnet build` has no new warnings or errors.
2. The migration's operations are the ones you expect, and the backfill runs.
3. `dotnet test` passes, including the isolation test.
4. With the app running, two tenants each see only their own data and their new rows are stamped with their own id,
   a request with no tenant gets `400`, an id the store does not have gets `404` (or `403` once an access validator
   is configured), and a tenant the caller may not use gets `403`.

Tell the user what is not isolated (raw SQL, `IgnoreQueryFilters()`, contexts without `UseTenantry()`, anything that
reaches the database directly), where each case is in their code, and what you did about it.

## Further reading

- Getting started: https://tenantry.dev/docs/core/getting-started
- EF Core integration: https://tenantry.dev/docs/core/efcore-integration
- Access control: https://tenantry.dev/docs/core/access-control
- Troubleshooting: https://tenantry.dev/docs/core/troubleshooting
