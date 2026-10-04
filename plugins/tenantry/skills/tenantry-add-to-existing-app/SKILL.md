---
name: tenantry-add-to-existing-app
description: Adds Tenantry multi-tenancy to an existing ASP.NET Core app that uses EF Core, isolating each tenant's rows in one shared database by a TenantId column. Use when making an existing .NET web app or API multi-tenant, or scoping its EF Core data per customer, organisation or account.
license: Apache-2.0
compatibility: .NET 8, 9 or 10 with the EF Core major of the target framework. Tenantry 0.7 or later.
metadata:
  tenantry-version: "0.7"
---

# Add Tenantry to an existing ASP.NET Core and EF Core app

Tenantry keeps each tenant's rows apart in a shared database. An entity that implements `ITenantEntity<TKey>` is
tenant-owned: `options.UseTenantry()` filters its queries to the current tenant and checks its saves. Every other
entity is shared by all tenants, and that is intended: reference data, catalogues and the tenant registry stay
unmarked. On each request, `app.UseTenantry()` resolves the tenant, checks the caller may use it, and makes it current.

Work through the steps in order. Do not skip the inspection or the tests: they are how you and the user know the
change is complete. Explain each choice to the user in plain words before you make it.

These instructions are for Tenantry 0.7 and later. If the project already references Tenantry (`dotnet list package`)
at 0.6 or earlier, upgrade every Tenantry package to 0.7 before anything else: 0.6 has isolation gaps that 0.7 fixes,
and some names used here do not exist in it. What changed:
https://github.com/tenantry-org/tenantry-core/blob/master/CHANGELOG.md

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

Use the type of the existing owner id as `TKey` (`Guid`, `int`, `long` or `string`), and use it everywhere.

```bash
# In the web project
dotnet add package Tenantry.AspNetCore --version 0.7.0
dotnet add package Tenantry.EfCore --version 0.7.0
```

NuGet reads `--version 0.7.0` as "0.7.0 or later" and restores the lowest such version, so the command fails while
0.7.0 is not published instead of installing 0.6. `dotnet list package --outdated` then shows newer patches.

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

Move the context's registration into a method of the app that both `Program.cs` and the tests call, and call
`UseTenantry()` there, after any `SaveChanges` interceptors of your own. The tests then check the registration the app
really runs with. Leave the database provider to the caller:

```csharp
using Microsoft.EntityFrameworkCore;

public static class AppDataRegistration
{
    public static IServiceCollection AddAppDbContext(
        this IServiceCollection services, Action<DbContextOptionsBuilder> useDatabase) =>
        services.AddDbContext<AppDbContext>(options =>
        {
            useDatabase(options);
            options.UseTenantry();
        });
}
```

```csharp
// Program.cs
builder.Services.AddAppDbContext(options => options.UseSqlServer(connectionString));
```

Do the same for every registration found in step 1, including factories and pooled contexts. A context whose
options do not call `UseTenantry()` is not isolated. The `DbContext` class itself needs no base class, interface or
override.

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

## 10. Write both isolation tests

Both are required; [references/isolation-test.md](references/isolation-test.md) says what each proves and does not.

1. The model test, [references/isolation-test.md](references/isolation-test.md): the app's `DbContext`, registered by
   the app's own `AddAppDbContext`, on SQLite in memory. A tenant reads only its rows, a write naming another tenant is
   refused, nothing is read or written without a tenant, and every unmarked entity type is one you meant to share.
2. The request test, [references/request-test.md](references/request-test.md): the whole app through
   `WebApplicationFactory<Program>`. Each tenant's requests see only its data, and requests with no tenant, an unknown
   tenant or a tenant the caller may not use are refused.

Then remove `UseTenantry()` from `AddAppDbContext` and run the tests once: they must fail. Put it back.

## 11. Verify

1. `dotnet build` has no new warnings or errors.
2. The migration's operations are the ones you expect, and the backfill runs.
3. `dotnet test` passes, including both isolation tests, and they failed with `UseTenantry()` removed.
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
