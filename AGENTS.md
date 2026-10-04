# Tenantry guidance for coding agents

Instructions for adding Tenantry, a multi-tenancy library for ASP.NET Core and EF Core, to a .NET application. This
file holds the same guidance as the skills in [plugins/tenantry/skills](plugins/tenantry/skills), in one place, for
agents that do not load skills. It is for Tenantry 0.7 and later (`Tenantry.Core`, `Tenantry.EfCore`,
`Tenantry.AspNetCore`) and Tenantry Pro 0.7 and later.

Check the version first with `dotnet list package`. If a project references Tenantry 0.6 or earlier, upgrade every
Tenantry package to 0.7 before anything else: 0.6 has isolation gaps that 0.7 fixes, and some names used here do not
exist in it (https://github.com/tenantry-org/tenantry-core/blob/master/CHANGELOG.md). Add packages with
`--version 0.7.0`, which makes NuGet install 0.7.0 exactly. If the command fails with NU1102, 0.7.0 is not published
yet: stop and tell the user; do not install 0.6 and do not remove `--version`. Once it succeeds, update every Tenantry
package to the newest 0.7.x patch that `dotnet list package --outdated` lists.

## How Tenantry isolates data

- An entity that implements `ITenantEntity<TKey>` (or derives from `TenantEntity<TKey>`) is tenant-owned. Every other
  entity is shared by all tenants, by design: reference data, catalogues, the tenant registry and membership tables
  stay unmarked.
- `options.UseTenantry()` on a context's options adds a query filter to every tenant-owned type, stamps `TenantId` on
  insert, rejects writes to another tenant's rows, and makes `TenantId` part of every `UPDATE` and `DELETE`.
- With no tenant current, tenant-owned queries return nothing and tenant-owned writes throw
  `TenantNotResolvedException`.
- `app.UseTenantry()` resolves each request's tenant, checks the caller may use it, and makes it current.
- Outside requests, code makes the tenant current with `ITenantScopeFactory<TKey>`.
- Not isolated: `Database.SqlQuery`, `SqlQueryRaw`, `ExecuteSql`, `ExecuteSqlRaw`, `ExecuteSqlInterpolated`,
  `IgnoreQueryFilters()`, SQL on `Database.GetDbConnection()` (Dapper, ADO.NET), and any context whose options do not
  call `UseTenantry()`. `FromSql` on a tenant-owned entity is filtered.

## Rules

1. Never resolve the tenant from a value the caller controls (header, subdomain, host, route) without an access
   validator such as `ValidateTenantAccessByClaim("tenant_id")`. `ResolveFromQueryString` is for development only.
2. Mark every entity whose rows belong to a tenant, child rows included. An unmarked child's set returns every
   tenant's rows.
3. Never set `TenantId` in application code. Tenantry stamps it. The one exception: when `TenantId` is part of an
   entity's primary key, set it from `ITenantContext<TKey>.CurrentTenantId` before `Add`, since EF Core cannot track
   an entity whose key is unset.
4. Call `UseTenantry()` on every registration of every context with tenant-owned entities, after your own
   `SaveChanges` interceptors.
5. `app.UseTenantry()` goes after `app.UseAuthentication()` and before `app.UseAuthorization()` and the endpoints.
6. Work that starts from a tenant id runs with `RunInScopeAsync(id, ...)`. `CreateScope(tenant)` and
   `ITenantContextSetter<TKey>.MakeCurrent(tenant)` trust the descriptor they are given: pass them only a descriptor
   read from the store.
7. Add the tenant predicate yourself to raw SQL, and keep `IgnoreQueryFilters()` to admin code behind authorization.
8. Ask the user when it is unclear which entities belong to a tenant or which tenant owns rows already in the database.
9. Write the two isolation tests (below) before calling the work done, and check they fail without `UseTenantry()`.
10. Tenantry Pro is a paid package. Do not add it, its feed or a licence key until the user confirms a subscription.

## Adding Tenantry to an existing ASP.NET Core and EF Core app

1. Inspect first and write down, with file paths: target frameworks and EF Core versions; every `DbContext` and every
   `AddDbContext`, `AddDbContextPool`, `AddDbContextFactory`, `AddPooledDbContextFactory` and `OnConfiguring`; every
   entity and whether its rows belong to one customer (look for `OrganisationId`, `AccountId`, `TenantId`); what
   identifies the customer on a request today; authentication and claims; raw SQL and `IgnoreQueryFilters`; background
   work.
2. Use the existing owner id's type as `TKey`. Install `Tenantry.AspNetCore` and `Tenantry.EfCore` with
   `--version 0.7.0`. With `string` ids, each tenant's id must be unique under the `TenantId` column's collation
   (SQL Server's and MySQL's defaults ignore case): a store keyed by the id in the same database guarantees it, and
   `UseInMemoryStore` refuses ids that differ only in case
   (https://tenantry.dev/docs/core/efcore-integration#string-tenant-ids-and-the-databases-collation).
3. Write a store over the existing organisations table, or start with `UseInMemoryStore`. The registry entity must not
   implement `ITenantEntity<TKey>`:

   ```csharp
   public sealed record OrganisationTenant(Guid TenantId, string Name, bool IsActive) : ITenantDescriptor<Guid>;

   public sealed class OrganisationTenantStore(AppDbContext db) : ITenantStore<Guid>
   {
       public async ValueTask<ITenantDescriptor<Guid>?> GetTenantAsync(Guid tenantId, CancellationToken ct = default) =>
           await db.Organisations.AsNoTracking().Where(o => o.Id == tenantId)
               .Select(o => new OrganisationTenant(o.Id, o.Name, o.IsActive)).SingleOrDefaultAsync(ct);

       public async ValueTask<IReadOnlyList<ITenantDescriptor<Guid>>> GetAllTenantsAsync(CancellationToken ct = default) =>
           await db.Organisations.AsNoTracking()
               .Select(o => new OrganisationTenant(o.Id, o.Name, o.IsActive)).ToListAsync<ITenantDescriptor<Guid>>(ct);
   }
   ```

   Implement `FindByIdentifierAsync` too when requests name tenants by a slug or domain rather than the id.
4. Choose resolution: `ResolveFromClaim("org_id")` when each token carries one tenant; otherwise
   `ResolveFromHeader`, `ResolveFromSubdomain`, `ResolveFromHost` (last) or `ResolveFromRouteValue` with an access
   validator (`ValidateTenantAccessByClaim`, or `ValidateTenantAccess<TValidator>()` over a membership table).
5. Register and add the middleware:

   ```csharp
   builder.Services.AddTenantry<Guid>(tenant => tenant
       .ResolveFromHeader("X-Tenant-Id")
       .ValidateTenantAccessByClaim("tenant_id")
       .UseStore<OrganisationTenantStore>()
       .RequireTenantByDefault()
       .ValidateTenantActivity(t => t is OrganisationTenant { IsActive: true }));

   // The context's registration lives in a method of the app that the tests call too (see below).
   builder.Services.AddAppDbContext(options => options.UseSqlServer(connectionString));

   app.UseAuthentication();
   app.UseTenantry();
   app.UseAuthorization();

   app.MapGet("/health", () => "ok").AllowMissingTenant();
   ```

6. Mark entities. For an existing owner column, rename the property and keep the column:

   ```csharp
   public class Project : ITenantEntity<Guid>
   {
       public int Id { get; set; }
       public string Name { get; set; } = "";
       public Guid TenantId { get; private set; }                 // was OrganisationId
       public Organisation? Organisation { get; private set; }
   }

   modelBuilder.Entity<Project>(project =>
   {
       project.Property(p => p.TenantId).HasColumnName("OrganisationId");
       project.HasOne(p => p.Organisation).WithMany().HasForeignKey(p => p.TenantId);
       project.HasIndex(p => new { p.TenantId, p.Name }).IsUnique();   // unique per tenant
   });
   ```

   For a type with no owner column, derive from `TenantEntity<TKey>`. Mark the root of an inheritance hierarchy; owned
   types follow their owner. Lead composite indexes with `TenantId`.
7. `dotnet ef migrations add AddTenantry`, and read it. For an existing owner column, expect no column operations.
   A new `TenantId` column gives existing rows the key type's default, which names no tenant. Ask the user which
   tenant the existing rows belong to before writing anything; there is no safe default. Then, in the migration after
   the `AddColumn`, assign them as the user said (often from a parent row: `UPDATE "Tasks" SET "TenantId" = (SELECT
   "OrganisationId" FROM "Projects" WHERE "Projects"."Id" = "Tasks"."ProjectId")`), and drop the default the
   `AddColumn` added with an `AlterColumn` that has `oldDefaultValue`. EF Core stores a `Guid` on SQLite as upper-case
   text. Afterwards, check no row names a tenant the store does not have.
8. Fix what breaks: remove code that set the owner id by hand; load entities before changing them instead of
   `Update(new Entity { Id = id })`; add the tenant predicate to raw SQL (`WHERE "TenantId" =
   {tenants.CurrentTenantId}`).
9. Write the isolation test (below), then run `dotnet build`, `dotnet test`, and the app with two tenants.

The full procedure, with references for stores, resolution, entities and the test:
[plugins/tenantry/skills/tenantry-add-to-existing-app](plugins/tenantry/skills/tenantry-add-to-existing-app/SKILL.md).

## The isolation tests

A test only proves the app is isolated if it uses the app's own registration. So move the context's registration
into a method that `Program.cs` and the tests both call, with `UseTenantry()` in it:

```csharp
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

Then write two tests:

1. The model test, on SQLite in memory: `AddTenantry<Guid>(tenant => tenant.UseInMemoryStore([TenantA, TenantB]))`
   and `AddAppDbContext(options => options.UseSqlite(connection))`. Create the schema in a plain scope
   (`services.CreateAsyncScope()`, which sets no tenant); add a row as tenant A and one as tenant B, each in its own
   `scopes.CreateScope(tenant)`; assert tenant A reads only its row; assert a row whose `TenantId` is set to B, added in
   A's scope, throws `TenantIsolationViolationException` with `Kind` `EntityWrite`; assert a plain scope reads nothing
   and its save throws `TenantNotResolvedException`; and assert `TenantModel.FindUnisolatedEntityTypes(db.Model)` lists
   exactly the types shared on purpose. It does not test resolution, access validation or endpoints. A complete file:
   [isolation-test.md](plugins/tenantry/skills/tenantry-add-to-existing-app/references/isolation-test.md).
2. The request test, with `WebApplicationFactory<Program>`: the real app against a test database set through
   configuration (never by replacing the context's registration), with a test authentication scheme for the claims.
   Create rows as tenant A and B through the endpoints and assert each lists only its own; assert no tenant gets
   `400`, an unknown tenant `404` (or `403` with an access validator) and a tenant the caller may not use `403`. A
   complete file: [request-test.md](plugins/tenantry/skills/tenantry-add-to-existing-app/references/request-test.md).

Remove `UseTenantry()` from `AddAppDbContext` once and run both: they must fail. Put it back.

## A new app

Decide the host (API, worker, or both), the key type, resolution and access validation, the store, and shared database
or database per tenant. Then follow the steps above from step 2, with no migration backfill. A complete API and worker:
[plugins/tenantry/skills/tenantry-new-app](plugins/tenantry/skills/tenantry-new-app/SKILL.md).

## Workers, jobs, console and desktop apps

Register `AddTenantry` from `Tenantry.Core` (no ASP.NET Core package) with a store, and the context with
`UseTenantry()`. Then:

| You have | Call | DI scope | Checks the tenant |
|----------|------|----------|-------------------|
| A tenant id (message, job data, argument) | `scopes.RunInScopeAsync(id, (scope, ct) => ..., ct)` | Opens one | Yes |
| A descriptor read from the store (a loop over tenants) | `scopes.CreateScope(tenant)` | Opens one | No |
| A descriptor, in a scope a framework opened | `setter.MakeCurrent(tenant)` | None | No |

`RunInScopeAsync` throws `TenantNotFoundException` for an unknown id and `TenantInactiveException` for a suspended
tenant; a consumer catches their base type, `TenantNotResolvedException`, so one message does not stop the host. A
context injected before `MakeCurrent` works with a shared database only: with a database per tenant, create it from
`IDbContextFactory<TContext>` inside the `MakeCurrent` block. `IServiceProvider.CreateScope()` sets no tenant. Open
scopes, or call `MakeCurrent`, in the method that does the work, never in an `async` helper that returns the handle.
Give each tenant its own scope and context. Capture the id for work that runs later. Hosted services read tenants
through `ITenantLookup<TKey>`. A loop over `GetAllTenantsAsync` checks `ITenantActivity<TKey>.IsActiveAsync` before
`CreateScope` when suspended tenants must be skipped. On a desktop UI thread, await `RunInScopeAsync`; blocking on it
deadlocks. Details: [plugins/tenantry/skills/tenantry-non-http](plugins/tenantry/skills/tenantry-non-http/SKILL.md).

## A database per tenant

Tenantry Core's `UseConnectionStrings` says how to find a tenant's connection string, and
`AddDbContextPerTenantDatabase` registers the context and connects it to the current tenant's database. The exact
registration is kept in one file, as it may change before a release:
[registration.md](plugins/tenantry/skills/tenantry-database-per-tenant/references/registration.md). Configure the
provider without a connection string, and register the context only this way (not also with `AddDbContext`). It
applies `UseTenantry()` itself. Creating a context with no tenant throws, so `dotnet ef` needs an
`IDesignTimeDbContextFactory`. Migrate each tenant's database in a deployment step: loop over
`ITenantLookup<TKey>.GetAllTenantsAsync()`, and in each `CreateScope(tenant)` call `Database.MigrateAsync()`.

## Moving from Finbuckle.MultiTenant

Keep `string` keys, unique under the `TenantId` column's collation as above. Replace `AddMultiTenant` with
`AddTenantry<string>`, strategies with resolvers (pass the names clients send; Finbuckle's default is `__tenant__`),
the store with one `ITenantStore<string>` whose `FindByIdentifierAsync` matches `Identifier`, and `UseMultiTenant()`
with `UseTenantry()` after `UseAuthentication()`. Finbuckle's header strategy did not check that the caller belongs to
the tenant, and neither does `ResolveFromHeader` alone: add an access validator, or, if the app has no authentication
yet, tell the user. Keep the store context's class name and map the tenant type to Finbuckle's `TenantInfo` table as
it is, so the store's migration has no operations. Contexts become plain `DbContext`s registered with `UseTenantry()`;
`[MultiTenant]` entities implement `ITenantEntity<string>`. Declare every key and index Finbuckle's `Adjust...`
methods changed, with their current names, so the migration has no operations. Queries with no tenant now return
nothing instead of throwing. Details:
[plugins/tenantry/skills/tenantry-migrate-from-finbuckle](plugins/tenantry/skills/tenantry-migrate-from-finbuckle/SKILL.md)
and https://tenantry.dev/docs/core/migrating-from-finbuckle.

## Reviewing an app that uses Tenantry

Read, do not change. Check, and report each finding with `path:line`, severity (High: cross-tenant read or write, or
choosing another tenant; Medium: fragile or wrong-tenant behaviour; Low: hardening and tests) and the smallest fix:
contexts without `UseTenantry()`; unmarked types whose rows belong to a tenant; raw SQL without a tenant predicate;
reachable `IgnoreQueryFilters()`; caller-controlled resolution without validation; pipeline order; descriptors built
from input passed to `CreateScope` or `MakeCurrent`; plain DI scopes in background work; `OnMissingTenant` relaxed for
every context; `string` tenant ids that the `TenantId` column's collation takes for one another; unique indexes
without `TenantId`; caches keyed without the tenant; and a missing isolation test. The
full list: [checks.md](plugins/tenantry/skills/tenantry-audit-isolation/references/checks.md).

## Tenantry Pro

A paid package from a private feed, with a licence key read from `Tenantry:License`. It adds, inside
`tenant.UsePro(pro => ...)`: `UseSchemaPerTenant` (SQL Server, PostgreSQL), `UseMixedMode`, provisioning and
offboarding (`AddDatabaseProvisioning`, `AddSchemaProvisioning`, `AddMigrations`, `AddSeeder`,
`ITenantProvisioner<TKey>`, `ITenantDeprovisioner<TKey>`), `app.RunTenantMigrationsIfRequestedAsync(args)` for
`dotnet run -- migrate-tenants`, `AddHangfirePropagation`, `AddQuartzPropagation`, `AddMassTransitPropagation`,
`AddRebusPropagation`, `AddAuditLogging` and `CacheConnectionStrings`. Installation and each feature:
[plugins/tenantry/skills/tenantry-pro](plugins/tenantry/skills/tenantry-pro/SKILL.md) and
https://tenantry.dev/docs/pro/installation.

## Documentation

- Core: https://tenantry.dev/docs/core/getting-started
- What is and is not isolated: https://tenantry.dev/docs/core/efcore-integration#what-is-and-isnt-isolated
- Non-HTTP hosts: https://tenantry.dev/docs/core/non-http-hosts
- Testing: https://tenantry.dev/docs/core/testing
- Troubleshooting: https://tenantry.dev/docs/core/troubleshooting
- Pro: https://tenantry.dev/docs/pro/getting-started

## A block for your own AGENTS.md or CLAUDE.md

Copy this into the instructions file of a project that uses Tenantry:

```markdown
## Tenantry (multi-tenancy)

This project uses Tenantry for tenant isolation. Guidance for agents:
https://github.com/tenantry-org/tenantry-agent-skills/blob/master/AGENTS.md

- Entities that implement ITenantEntity<TKey> are tenant-owned; every other entity is shared by all tenants on purpose.
  Mark new entities whose rows belong to one tenant, child rows included.
- Never set TenantId in code; Tenantry stamps it (except when TenantId is part of a primary key: set it before Add).
  Load an entity before changing it.
- Every DbContext registration with tenant-owned entities calls .UseTenantry().
- Raw SQL (SqlQuery, ExecuteSql, Dapper) and IgnoreQueryFilters() are not isolated: add the tenant predicate yourself,
  and keep cross-tenant reads to admin code behind authorization.
- Outside requests, run work by tenant id with ITenantScopeFactory<TKey>.RunInScopeAsync. CreateScope and
  ITenantContextSetter<TKey>.MakeCurrent trust their descriptor: pass only one read from the store.
- Tests for tenant-owned data write as one tenant and read as another.
```
