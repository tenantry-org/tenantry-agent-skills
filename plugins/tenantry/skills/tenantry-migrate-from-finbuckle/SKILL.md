---
name: tenantry-migrate-from-finbuckle
description: Moves an ASP.NET Core and EF Core application from Finbuckle.MultiTenant to Tenantry, keeping the existing string tenant ids and TenantId columns. Use when a project references Finbuckle.MultiTenant packages (AddMultiTenant, WithHeaderStrategy, WithEFCoreStore, IMultiTenantDbContext, MultiTenantDbContext, [MultiTenant], IsMultiTenant, ITenantInfo) and the user wants to replace it with Tenantry, compare the two, or plan the migration.
license: Apache-2.0
compatibility: Written from Tenantry's guide for Finbuckle.MultiTenant 10.1.4 and Tenantry 0.7.
metadata:
  tenantry-version: "0.7"
---

# Migrate from Finbuckle.MultiTenant to Tenantry

Work through the steps in order, then the checklist. Most of the work is mechanical; the parts that need a decision
are the tenant store, the indexes Finbuckle adjusted, and code that relied on Finbuckle's mismatch and not-set modes.
How each Finbuckle type and method maps is in [references/concept-map.md](references/concept-map.md).

## 0. Inventory

List every Finbuckle package, `using` directive and call (`grep -rn "Finbuckle\|MultiTenant" --include=*.cs`), every
context and how it gets its tenant, every entity marked `[MultiTenant]` or `IsMultiTenant()`, every call to
`AdjustKey`, `AdjustIndex`, `AdjustIndexes` or `AdjustUniqueIndexes`, and every `ConfigurePerTenant` and
`WithPerTenantAuthentication`. Write the list down; the checklist at the end refers to it.

## 1. Swap the packages

```bash
dotnet remove package Finbuckle.MultiTenant.AspNetCore
dotnet remove package Finbuckle.MultiTenant.EntityFrameworkCore
dotnet add package Tenantry.AspNetCore
dotnet add package Tenantry.EfCore
```

Add `Tenantry.Options` for per-tenant options. Remove `Finbuckle.MultiTenant.Identity.EntityFrameworkCore` too if it is
used, and follow https://tenantry.dev/docs/core/aspnetcore-identity.

## 2. Keep string tenant ids

Finbuckle's ids and its `TenantId` columns are strings. Register `AddTenantry<string>` and the columns and data stay
as they are. Changing the key type is a separate change with a data migration; do not combine it with this one.

## 3. Move the tenant type and the store

Your tenant type implements `ITenantDescriptor<string>` (`TenantId`, `Name`). Finbuckle's strategies return an
identifier that the store matches against `Identifier`; in Tenantry the store's `FindByIdentifierAsync` does that.
When identifiers differ from ids, keep `Identifier` on your type and look it up there. Code for the store is in
[references/concept-map.md](references/concept-map.md#the-tenant-type-and-store). Tenantry has one store per app.

## 4. Register Tenantry and move the middleware

```csharp
builder.Services.AddDbContext<CatalogDbContext>(options => options.UseSqlServer(connectionString));

builder.Services.AddTenantry<string>(tenant => tenant
    .ResolveFromHeader("X-Tenant")            // the header name your clients already send
    .UseStore<AppTenantStore>()
    .RequireTenantByDefault());

builder.Services.AddDbContext<AppDbContext>(options => options
    .UseSqlServer(connectionString)
    .UseTenantry());

var app = builder.Build();

app.UseAuthentication();
app.UseTenantry();        // where UseMultiTenant() was, but after UseAuthentication()
app.UseAuthorization();
```

`UseTenantry()` goes after `UseAuthentication()`. With per-tenant authentication, also call
`app.UseTenantResolution()` before `app.UseAuthentication()`. Finbuckle's header, claim and route names default to
`__tenant__`; pass the names the clients use. Mark endpoints that work without a tenant with `AllowMissingTenant()`.

## 5. Move the EF Core setup

The context becomes a plain `DbContext` registered with `UseTenantry()`: remove the `IMultiTenantDbContext`
interface or Finbuckle base class, the accessor constructor parameter, `TenantInfo`, `TenantMismatchMode`,
`TenantNotSetMode` and the `SaveChanges` overrides that call `EnforceMultiTenant()`. Entities implement
`ITenantEntity<string>` (or derive from `TenantEntity<string>`). Declare the keys and indexes Finbuckle adjusted, then
add a migration, which should have no operations. Details: [references/ef-core.md](references/ef-core.md).

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
12. `dotnet build` and `dotnet test` pass, and the isolation test from the `tenantry-add-to-existing-app` skill passes
    against the migrated model.

## Further reading

- The full guide: https://tenantry.dev/docs/core/migrating-from-finbuckle
