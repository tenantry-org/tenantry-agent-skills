# Checks

Run each search from the repository root, skipping `bin/`, `obj/` and generated migrations unless a check says
otherwise. `grep -rn --include='*.cs'` is shown; use whatever search tool you have.

## 1. Every context with tenant-owned entities calls `UseTenantry()`

Search: `AddDbContext`, `AddDbContextPool`, `AddDbContextFactory`, `AddPooledDbContextFactory`, `OnConfiguring`,
`new DbContextOptionsBuilder`, `AddDbContextPerTenantDatabase`.

- High: a registration, factory or `OnConfiguring` for a context that has tenant-owned entity types, whose options do
  not call `.UseTenantry()`. Queries are unfiltered and saves unchecked.
- Not a finding: `AddDbContextPerTenantDatabase`, which applies `UseTenantry()` itself; a design-time factory used only
  by `dotnet ef`.
- Medium: `SaveChanges` interceptors added after `UseTenantry()`, which then are not checked (a soft delete that turns
  a delete into an update, say).

## 2. Every tenant's rows are in a tenant-owned type

List every entity type of each context (the `DbSet` properties, `modelBuilder.Entity<...>` calls and
`IEntityTypeConfiguration` classes) and mark each tenant-owned (implements `ITenantEntity<TKey>` or derives from
`TenantEntity<TKey>`) or not.

- High: an unmarked type with a column that names its owner (`TenantId`, `OrganisationId`, `AccountId`,
  `CustomerId`), or an unmarked child of a tenant-owned type (an `OrderLine` with an `OrderId`), that the code queries
  directly (`db.OrderLines`, `db.Set<OrderLine>()`) or that an endpoint can write. Its set returns every tenant's rows.
- Medium: the same type reached only through a filtered parent's navigation today.
- High: a type with a `TenantId` property that does not implement the interface: it looks isolated and is not.
- High: the tenant registry entity implements `ITenantEntity<TKey>` (no tenant can ever be resolved), or a membership
  table is tenant-owned when the access validator reads it with no tenant current.
- Low: no test or `OnUnmarkedEntityType` setting lists the types shared on purpose, so a new unmarked type would go
  unnoticed. Suggest the `FindUnisolatedEntityTypes` test from the `tenantry-add-to-existing-app` skill.

## 3. Raw SQL and connections

Search: `SqlQuery`, `SqlQueryRaw`, `ExecuteSql`, `ExecuteSqlRaw`, `ExecuteSqlInterpolated`, `FromSql`,
`GetDbConnection`, `SqlCommand`, `NpgsqlCommand`, `MySqlCommand`, `SqliteCommand`, `.QueryAsync<`, `.ExecuteAsync(`,
`.QueryFirst`, `.QuerySingle` (Dapper).

- High: SQL that reads or changes a tenant-owned table without a `TenantId` predicate bound to the current tenant
  (`ITenantContext<TKey>.CurrentTenantId`).
- High: a `TenantId` predicate whose value comes from request input (a route value, the body) rather than the current
  tenant.
- Not a finding: `FromSql`, `FromSqlRaw` or `FromSqlInterpolated` on a tenant-owned entity: EF Core applies the tenant
  filter over it.
- Medium: tenant SQL that runs where the tenant may be absent without checking `HasTenant`.

## 4. `IgnoreQueryFilters()`

Search: `IgnoreQueryFilters`.

- High: used in code a tenant's user can reach (an endpoint without an admin authorization policy), or followed by
  `ExecuteUpdate` or `ExecuteDelete` outside deliberate maintenance code.
- Medium: used where only another filter should be removed; on EF Core 10, `IgnoreQueryFilters([TenantryQueryFilters.Tenant])`
  or naming your own filter is narrower.
- Check shared helpers and repositories that return `IQueryable` with the filters already removed.

## 5. Resolution and access validation

Read the `AddTenantry` call.

- High: `ResolveFromHeader`, `ResolveFromSubdomain`, `ResolveFromHost`, `ResolveFromRouteValue` or a custom resolver
  whose value the caller controls, with no `ValidateTenantAccessByClaim`, `ValidateTenantAccess(...)` or
  `ValidateTenantAccess<T>()`. Any caller can choose any tenant.
- High: `ResolveFromQueryString` outside development.
- High: `ResolveFromClaim` before a header resolver when tokens can lack the claim and nothing validates the header's
  tenant, so anonymous callers name a tenant by header.
- Medium: `ResolveFromClaim` with tokens that list several tenants: it takes the first claim only.
- Medium: an access validator that compares a claim with a slug or name rather than the tenant id, or uses
  `HasClaim` on a claim that holds a JSON array.
- High: `ResolveFromPropagationHeader` with an `isTrustedCaller` check that accepts callers outside your services.
- Medium: suspended tenants refused only in an access validator: background work still runs for them. They belong in
  `ValidateTenantActivity`.

## 6. Pipeline order and endpoints

Read `Program.cs` (or `Startup.Configure`).

- High: `UseTenantry()` missing in a web app that resolves tenants (the app does not start, so this usually shows as a
  startup failure), or placed after the endpoints or after middleware that reads tenant data.
- High: claim resolution or claim validation with `UseTenantry()` before `UseAuthentication()`: no user is seen.
- Medium: a custom pipeline with `UseTenantry()` before `UseRouting()`: endpoint metadata is ignored.
- Medium: endpoints that read or write tenant data without `RequireTenant()` or `RequireTenantByDefault()`. They do
  not leak (queries return nothing), but behave as an empty tenant.
- High: `AllowMissingTenant()` on an endpoint that writes tenant data through maintenance code or raw SQL.

## 7. Work outside requests

Search: `BackgroundService`, `IHostedService`, `CreateScope(`, `CreateAsyncScope(`, `MakeCurrent(`,
`MakeNoTenantCurrent(`, `RunInScopeAsync(`, `new TenantDescriptor`, `Task.Run(`, Hangfire, Quartz, MassTransit and
Rebus handlers.

- High: `ITenantScopeFactory.CreateScope(...)` or `ITenantContextSetter.MakeCurrent(...)` given a descriptor built from
  input (`new TenantDescriptor<TKey> { TenantId = message.TenantId }`) instead of one read from the store. They trust the
  descriptor; work that starts from an id must use `RunInScopeAsync`.
- Medium: a hosted service that uses `IServiceProvider.CreateScope()` and then tenant-owned data: no tenant is current,
  so reads return nothing and writes throw.
- Medium: `MakeCurrent` or `CreateScope` called inside an `async` helper that returns the handle or scope: the tenant
  is not current for the caller.
- Medium: a loop over `GetAllTenantsAsync` with `CreateScope` that does not check `ITenantActivity<TKey>` for work that
  should skip suspended tenants.
- High: `CurrentTenant` or a tenant's `DbContext` kept in a singleton field, or a `Task.Run` or queued callback that
  outlives the scope it was started in and uses its services.
- Medium: a hosted service that injects the scoped `ITenantStore<TKey>` instead of `ITenantLookup<TKey>`.

## 8. Write policy

Search: `ConfigureEfCoreIsolation`, `OnMissingTenant`, `MissingTenantBehavior`.

- High: `OnMissingTenant = MissingTenantBehavior.Allow` or `Warn` set for every context in `ConfigureEfCoreIsolation`.
  Only a dedicated maintenance context should relax it, with `UseTenantry(o => ...)`.
- Medium: code that sets `TenantId` from request input. A value naming another tenant is refused, but the code trusts
  input it should not need.

## 9. Indexes

- Medium: a unique index on a tenant-owned type that does not include `TenantId`: one tenant's value blocks another's
  and reveals that it exists.
- Low: no index leads with `TenantId` on large tenant-owned tables.

## 10. Caches

Search: `IMemoryCache`, `IDistributedCache`, `HybridCache`, `AddOutputCache`, `OutputCache`, `ResponseCaching`.

- High: tenant data cached under a key that does not include the tenant, outside Tenantry's isolation:
  `IMemoryCache` or `IDistributedCache` used directly, `HybridCache` without `IsolateCaches()` (Tenantry.Caching), or
  output caching of tenant responses without `IsolateOutputCache()`.
- Medium: `CacheTenants()` without `ITenantInvalidator<TKey>.InvalidateAsync` where tenants are suspended or renamed, so
  a suspended tenant is served until its entry expires.

## 11. A database per tenant

When `AddDbContextPerTenantDatabase` or `UseConnectionStrings` is used:

- High: a pooled registration (`AddDbContextPool`, `AddPooledDbContextFactory`) that reads the tenant's connection
  string in its options callback: every lease keeps the first tenant's database.
- High: the same context also registered with `AddDbContext`.
- Medium: SQL run directly on `Database.GetDbConnection()` after a tenant switch: the guard cannot see it.

## 12. Tests

- Low, or Medium for an app with many tenant-owned types: no test writes as one tenant and reads as another, or none
  checks that a write naming another tenant is refused.
