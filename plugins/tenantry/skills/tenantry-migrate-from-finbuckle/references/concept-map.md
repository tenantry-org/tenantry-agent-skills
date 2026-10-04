# How Finbuckle's concepts map to Tenantry

| Finbuckle.MultiTenant | Tenantry |
|-----------------------|----------|
| `ITenantInfo`, `TenantInfo` (`Id`, `Identifier`, `Name`) | `ITenantDescriptor<TKey>`, `TenantDescriptor<TKey>` (`TenantId`, `Name`) |
| `AddMultiTenant<TTenantInfo>()` | `AddTenantry<TKey>(tenant => ...)` |
| `WithHeaderStrategy()`, `WithHostStrategy()` and the other strategies | `ResolveFromHeader(...)`, `ResolveFromSubdomain()` and the other resolvers |
| One or more stores (`WithInMemoryStore()`, `WithEFCoreStore<...>()`) | One `ITenantStore<TKey>`: `UseInMemoryStore(...)` or `UseStore<TStore>()` |
| `UseMultiTenant()`, before `UseAuthentication()` | `UseTenantry()`, after `UseAuthentication()` |
| `IMultiTenantContextAccessor<TTenantInfo>`, `HttpContext.GetMultiTenantContext<TTenantInfo>()` | `ITenantContext<TKey>`; your own type with `GetCurrentTenant<TTenant>()` |
| `IsResolved` | `HasTenant` |
| `IMultiTenantContextSetter`, `HttpContext.SetTenantInfo(...)` | `ITenantContextSetter<TKey>.MakeCurrent(tenant)`, or `ITenantScopeFactory<TKey>` for a new DI scope |
| Finbuckle's base context, or `IMultiTenantDbContext` with `EnforceMultiTenant()` | A plain `DbContext` registered with `options.UseTenantry()` |
| `[MultiTenant]`, `IsMultiTenant()` | `ITenantEntity<TKey>` or `TenantEntity<TKey>` on the entity |
| `IsNotMultiTenant()` | Nothing: an entity without `ITenantEntity<TKey>` is shared |
| `TenantMismatchMode`, `TenantNotSetMode` | No setting: see [behaviour-changes.md](behaviour-changes.md) |
| `ConfigurePerTenant<TOptions, TTenantInfo>(...)` and its named and `ConfigureAllPerTenant` variants | `ConfigurePerTenant(perTenant => perTenant.Configure<TOptions>(...))`, `Configure<TOptions>(name, ...)`, `ConfigureAll<TOptions>(...)` |
| `WithPerTenantAuthentication()` | `Configure<TOptions>(scheme, ...)` in `ConfigurePerTenant`, with `UseTenantResolution()` |
| `MultiTenantIdentityDbContext` | `IdentityDbContext<TUser>` with a tenant-owned user type |
| `ShortCircuitWhenTenantNotResolved()` | `RequireTenantByDefault()` |
| `ExcludeFromMultiTenantResolution()` | `AllowMissingTenant()` |
| `MultiTenantOptions.Events` | `ConfigureResolution(o => o.OnResolved = ...)` and `OnRejected` |
| Finbuckle's static `Create` for a context per tenant | `ITenantScopeFactory<string>.CreateScope(tenant)`, then resolve the context from the scope |
| A connection string on the tenant, read in `OnConfiguring` | `UseConnectionStrings` with `AddDbContextPerTenantDatabase` (the `tenantry-database-per-tenant` skill) |
| `Constants.TenantToken`, the named filter | `TenantryQueryFilters.Tenant` |
| `Reset()`, `Clear(tenantId)` for per-tenant options | `ITenantInvalidator<string>.InvalidateAsync(tenantId)` |

## Strategies and resolvers

| Finbuckle | Tenantry |
|-----------|----------|
| `WithHeaderStrategy()` | `ResolveFromHeader("__tenant__")` |
| `WithClaimStrategy()` | `ResolveFromClaim("__tenant__")` |
| `WithRouteStrategy()` | `ResolveFromRouteValue("__tenant__")` |
| `WithHostStrategy()` | `ResolveFromSubdomain(o => o.BaseDomains.Add("example.com"))` |
| `WithHostStrategy("__tenant__")` | `ResolveFromHost()` |
| `WithStrategy<T>()`, `WithDelegateStrategy(...)`, `WithHttpContextStrategy(...)` | `UseResolver<T>()` with an `ITenantResolver` of your own |

Tenantry's header resolver needs a name; its claim defaults to `tenant_id` and its route value to `tenant`. Pass the
names the clients send. Finbuckle's default host template takes the first label of any host; `ResolveFromSubdomain()`
without base domains takes it only from a host with at least three labels, so list your domains in `BaseDomains`,
`localhost` included.

## The tenant type and store

For Finbuckle's EF Core store (`EFCoreStoreDbContext<TTenantInfo>`), whose table is `TenantInfo` with a string `Id`
key, a required `Identifier` with a unique index, and a nullable `Name`:

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;

public class AppTenant : ITenantDescriptor<string>
{
    public string TenantId { get; set; } = "";     // Finbuckle's Id
    public string Identifier { get; set; } = "";   // what requests carry
    public string? Name { get; set; }              // nullable, as in Finbuckle's table

    string ITenantDescriptor.Name => Name ?? Identifier;
}

// The store's context keeps its class name, so its existing migrations and snapshot still compile. It now derives
// from DbContext, and maps AppTenant to Finbuckle's table as it is.
public class TenantStoreDbContext(DbContextOptions<TenantStoreDbContext> options) : DbContext(options)
{
    public DbSet<AppTenant> Tenants => Set<AppTenant>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.Entity<AppTenant>(tenant =>
        {
            tenant.ToTable("TenantInfo");
            tenant.HasKey(t => t.TenantId);
            tenant.Property(t => t.TenantId).HasColumnName("Id");
            tenant.HasIndex(t => t.Identifier).IsUnique();
        });
}

public sealed class AppTenantStore(TenantStoreDbContext db) : ITenantStore<string>
{
    public async ValueTask<ITenantDescriptor<string>?> GetTenantAsync(string tenantId, CancellationToken ct = default) =>
        await db.Tenants.AsNoTracking().SingleOrDefaultAsync(t => t.TenantId == tenantId, ct);

    public async ValueTask<IReadOnlyList<ITenantDescriptor<string>>> GetAllTenantsAsync(CancellationToken ct = default) =>
        await db.Tenants.AsNoTracking().ToListAsync<ITenantDescriptor<string>>(ct);

    public async ValueTask<ITenantDescriptor<string>?> FindByIdentifierAsync(string identifier, CancellationToken ct = default) =>
        await db.Tenants.AsNoTracking().SingleOrDefaultAsync(t => t.Identifier == identifier, ct);
}
```

Once the project builds without Finbuckle (after the skill's step 5), check the mapping matches the table:

```bash
dotnet ef migrations add MoveTenantStoreToTenantry --context TenantStoreDbContext
```

The migration's `Up` and `Down` must be empty; only the snapshot changes. An operation in it means the mapping
differs from the table: a dropped index, a column made required or renamed. Fix the mapping, remove the migration
(`dotnet ef migrations remove --context TenantStoreDbContext`) and generate it again. Keep the empty migration, so the
snapshot matches the new model. If the tenant type has more properties than Finbuckle's (yours derived from
`TenantInfo`), map each to its existing column the same way.

`UseInMemoryStore` finds tenants by id only, so it replaces Finbuckle's in-memory store only where each identifier
equals its id. Add `CacheTenants()` to avoid a database read per request. Tenantry builds in no configuration,
distributed cache, HTTP remote or echo store, and has no methods that add or remove tenants: write the store over
whatever held them.

## What has no equivalent

- Base path, session, static and remote authentication callback strategies: write an `ITenantResolver`, or use a
  `{tenant}` route value with `ResolveFromRouteValue()`. Nothing rewrites `PathBase`.
- `BypassWhen` and `BypassWhenEndpointNotResolved`: put middleware that must skip resolution, such as static files,
  before `UseTenantry()`.
- `IgnoredIdentifiers`: the subdomain resolver has `IgnoredSubdomains`, and a store can return `null` for any other
  identifier.
- `StrategyInfo` and `StoreInfo` are not recorded.
