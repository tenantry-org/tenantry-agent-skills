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

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;

public class AppTenant : ITenantDescriptor<string>
{
    public string TenantId { get; set; } = "";     // Finbuckle's Id
    public string Identifier { get; set; } = "";   // what requests carry
    public string Name { get; set; } = "";
}

public class CatalogDbContext(DbContextOptions<CatalogDbContext> options) : DbContext(options)
{
    public DbSet<AppTenant> Tenants => Set<AppTenant>();
}

public sealed class AppTenantStore(CatalogDbContext db) : ITenantStore<string>
{
    public async ValueTask<ITenantDescriptor<string>?> GetTenantAsync(string tenantId, CancellationToken ct = default) =>
        await db.Tenants.AsNoTracking().SingleOrDefaultAsync(t => t.TenantId == tenantId, ct);

    public async ValueTask<IReadOnlyList<ITenantDescriptor<string>>> GetAllTenantsAsync(CancellationToken ct = default) =>
        await db.Tenants.AsNoTracking().ToListAsync<ITenantDescriptor<string>>(ct);

    public async ValueTask<ITenantDescriptor<string>?> FindByIdentifierAsync(string identifier, CancellationToken ct = default) =>
        await db.Tenants.AsNoTracking().SingleOrDefaultAsync(t => t.Identifier == identifier, ct);
}
```

This replaces Finbuckle's EF Core store. Map `AppTenant` to the table Finbuckle's store used. `UseInMemoryStore` finds
tenants by id only, so it replaces Finbuckle's in-memory store only where each identifier equals its id. Add
`CacheTenants()` to avoid a database read per request. Tenantry builds in no configuration, distributed cache, HTTP
remote or echo store, and has no methods that add or remove tenants: write the store over whatever held them.

## What has no equivalent

- Base path, session, static and remote authentication callback strategies: write an `ITenantResolver`, or use a
  `{tenant}` route value with `ResolveFromRouteValue()`. Nothing rewrites `PathBase`.
- `BypassWhen` and `BypassWhenEndpointNotResolved`: put middleware that must skip resolution, such as static files,
  before `UseTenantry()`.
- `IgnoredIdentifiers`: the subdomain resolver has `IgnoredSubdomains`, and a store can return `null` for any other
  identifier.
- `StrategyInfo` and `StoreInfo` are not recorded.
