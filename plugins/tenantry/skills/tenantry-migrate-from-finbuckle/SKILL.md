---
name: tenantry-migrate-from-finbuckle
description: Moves an ASP.NET Core and EF Core app from Finbuckle.MultiTenant to Tenantry, keeping its string tenant ids and TenantId columns. Use when a project references Finbuckle.MultiTenant packages and the user wants Tenantry instead.
license: Apache-2.0
compatibility: Written from Tenantry's guide for Finbuckle.MultiTenant 10.1.4 and Tenantry 0.7.
metadata:
  tenantry-version: "0.7"
---

# Migrate from Finbuckle.MultiTenant to Tenantry

Work through the steps in order, then the checklist. Most of the work is mechanical; the parts that need a decision
are the tenant store, the indexes Finbuckle adjusted, and code that relied on Finbuckle's mismatch and not-set modes.
How each Finbuckle type and method maps is in [references/concept-map.md](references/concept-map.md).

These instructions are for Tenantry 0.7 and later; do not move to 0.6, which has isolation gaps that 0.7 fixes
(https://github.com/tenantry-org/tenantry-core/blob/master/CHANGELOG.md).

## 0. Inventory

List every Finbuckle package, `using` directive and call (`grep -rn "Finbuckle\|MultiTenant" --include='*.cs' .`, leaving out `bin/`, `obj/` and existing migrations), every
context and how it gets its tenant, every entity marked `[MultiTenant]` or `IsMultiTenant()`, every call to
`AdjustKey`, `AdjustIndex`, `AdjustIndexes` or `AdjustUniqueIndexes`, and every `ConfigurePerTenant` and
`WithPerTenantAuthentication`. Write the list down; the checklist at the end refers to it.

## 1. Swap the packages

```bash
dotnet remove package Finbuckle.MultiTenant.AspNetCore
dotnet remove package Finbuckle.MultiTenant.EntityFrameworkCore
dotnet add package Tenantry.AspNetCore --version 0.7.0
dotnet add package Tenantry.EfCore --version 0.7.0
```

`--version 0.7.0` means 0.7.0 or later, so the command fails, rather than installing 0.6, until 0.7.0 is published.

Add `Tenantry.Options` for per-tenant options. Remove `Finbuckle.MultiTenant.Identity.EntityFrameworkCore` too if it is
used, and follow https://tenantry.dev/docs/core/aspnetcore-identity.

## 2. Keep string tenant ids

Finbuckle's ids and its `TenantId` columns are strings. Register `AddTenantry<string>` and the columns and data stay
as they are. Changing the key type is a separate change with a data migration; do not combine it with this one.

## 3. Move the tenant type and the store

Your tenant type implements `ITenantDescriptor<string>` (`TenantId`, `Name`). Finbuckle's strategies return an
identifier that the store matches against `Identifier`; in Tenantry the store's `FindByIdentifierAsync` does that.
Tenantry has one store per app.

With Finbuckle's EF Core store, keep its table and its migrations:

1. Keep the class name of the store's context (`TenantStoreDbContext`, or whatever the app called it), so its
   existing migrations and model snapshot still compile, and make it derive from `DbContext`. If you rename it,
   rename it in the `[DbContext(typeof(...))]` attribute of each of its migrations and of its snapshot too.
2. Map your tenant type to Finbuckle's table exactly: table `TenantInfo`, key `Id`, a unique index on `Identifier`,
   and a nullable `Name`.
3. Write the store over it.

The code for all three is in [references/concept-map.md](references/concept-map.md#the-tenant-type-and-store). Its
migration, which checks the mapping, comes in step 5, once the project builds without Finbuckle.

## 4. Register Tenantry and move the middleware

```csharp
builder.Services.AddDbContext<TenantStoreDbContext>(options => options.UseSqlServer(connectionString));   // as before

builder.Services.AddTenantry<string>(tenant => tenant
    .ResolveFromHeader("X-Tenant")              // the header name your clients already send
    .ValidateTenantAccessByClaim("tenant_id")   // the caller's tenant_id claims must name the tenant
    .UseStore<AppTenantStore>()
    .RequireTenantByDefault());

builder.Services.AddDbContext<AppDbContext>(options => options
    .UseSqlServer(connectionString)
    .UseTenantry());

var app = builder.Build();

app.UseAuthentication();  // if the app has it
app.UseTenantry();        // where UseMultiTenant() was, but after UseAuthentication()
app.UseAuthorization();   // if the app has it
```

Finbuckle's header strategy did not check that the caller belongs to the tenant it names, and neither does
`ResolveFromHeader` alone: any caller can choose any tenant. Add an access validator. With signed-in users whose
token lists their tenants, that is `ValidateTenantAccessByClaim` with the claim type the token uses; with a membership
table, a validator of your own (https://tenantry.dev/docs/core/access-control). If the app has no authentication yet,
the validator has nothing to check: leave it out, tell the user that callers can choose any tenant, as they could
with Finbuckle, and that authentication and a validator must come before production.

`UseTenantry()` goes after `UseAuthentication()`. With per-tenant authentication, also call
`app.UseTenantResolution()` before `app.UseAuthentication()`. Finbuckle's header, claim and route names default to
`__tenant__`; pass the names the clients use. Mark endpoints that work without a tenant with `AllowMissingTenant()`.

## 5. Move the EF Core setup

The context becomes a plain `DbContext` registered with `UseTenantry()`: remove the `IMultiTenantDbContext`
interface or Finbuckle base class, the accessor constructor parameter, `TenantInfo`, `TenantMismatchMode`,
`TenantNotSetMode` and the `SaveChanges` overrides that call `EnforceMultiTenant()`. Entities implement
`ITenantEntity<string>` (or derive from `TenantEntity<string>`). Declare the keys and indexes Finbuckle adjusted. A
design-time factory (`IDesignTimeDbContextFactory`) for the context loses its placeholder tenant and calls
`UseTenantry()` on its options. Details: [references/ef-core.md](references/ef-core.md).

Then, with the project building, add a migration for each context and read both:

```bash
dotnet ef migrations add MoveTenantStoreToTenantry --context TenantStoreDbContext
dotnet ef migrations add MoveToTenantry --context AppDbContext
```

Each must have empty `Up` and `Down` methods; only the snapshots change. An operation means a mapping differs from
the database: fix it, remove that migration (`dotnet ef migrations remove --context <context>`) and add it again.
What each kind of operation means is in [references/ef-core.md](references/ef-core.md#the-migration) and
[references/concept-map.md](references/concept-map.md#the-tenant-type-and-store).

## 6. Move per-tenant options and authentication

`services.ConfigurePerTenant<TOptions, TTenantInfo>(...)` becomes
`tenant.ConfigurePerTenant(perTenant => perTenant.Configure<TOptions>((options, t) => ...))` inside `AddTenantry`
(Tenantry.Options). Code that reads per-tenant values through `IOptions<TOptions>` changes to
`IOptionsSnapshot<TOptions>`, or `IOptionsMonitor<TOptions>` in a singleton. Per-tenant authentication is in
https://tenantry.dev/docs/core/authentication-per-tenant.

## 7. Update tests and code that depended on Finbuckle's behaviour

The behaviour that changes is in [references/behaviour-changes.md](references/behaviour-changes.md). The two that break
tests most often: a query with no tenant now returns no rows instead of throwing, and a write naming another tenant
always throws.

## Checklist

1. No Finbuckle package or `using` directive is left.
2. Tenantry is registered with `string` keys.
3. The tenant type implements `ITenantDescriptor<string>`, and the store maps identifiers in `FindByIdentifierAsync`.
4. The resolvers read the header, claim or route value the clients already send.
5. `UseTenantry()` runs after `UseAuthentication()`, and with per-tenant authentication `UseTenantResolution()` runs
   before it.
6. Tenant-owned entities implement `ITenantEntity<string>`, and each context is a plain `DbContext` registered with
   `UseTenantry()`.
7. The keys and indexes Finbuckle adjusted are declared, and the new migration has no operations.
8. Code that ignored Finbuckle's named filter names `TenantryQueryFilters.Tenant`.
9. Code that relied on `TenantMismatchMode` or `TenantNotSetMode` uses a maintenance context.
10. Per-tenant options use `ConfigurePerTenant`, and per-tenant sign-in is checked with a tenant claim.
11. Tests that expected an exception without a tenant expect empty results.
12. Both migrations, the store context's and the app context's, have no operations.
13. `dotnet build` and `dotnet test` pass, including both isolation tests from the `tenantry-add-to-existing-app` skill
    (its `references/isolation-test.md` and `references/request-test.md`), written against the migrated app. The
    first needs the context's registration moved into an `AddAppDbContext` method, as that skill's step 7 shows, so
    the test checks the registration the app runs with.

## Further reading

- The full guide: https://tenantry.dev/docs/core/migrating-from-finbuckle
