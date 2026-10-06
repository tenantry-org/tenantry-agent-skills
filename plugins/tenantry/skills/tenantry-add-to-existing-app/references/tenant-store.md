# The tenant store

An application has exactly one `ITenantStore<TKey>`; registering a second throws. Tenantry has no tenants table of
its own: the store reads whatever already lists your customers.

```csharp no-compile
public interface ITenantStore<TKey>
{
    ValueTask<ITenantDescriptor<TKey>?> GetTenantAsync(TKey tenantId, CancellationToken ct = default);
    ValueTask<IReadOnlyList<ITenantDescriptor<TKey>>> GetAllTenantsAsync(CancellationToken ct = default);

    // Has a default: parses the identifier as TKey and calls GetTenantAsync.
    ValueTask<ITenantDescriptor<TKey>?> FindByIdentifierAsync(string identifier, CancellationToken ct = default);
}
```

## No tenants table yet: the in-memory store

For a first step, tests and a fixed list of tenants:

```csharp
tenant.UseInMemoryStore(
[
    new TenantDescriptor<Guid> { TenantId = Guid.Parse("8d2c3c1e-6f0e-4a3c-9a43-0f5c2f6a1b01"), Name = "Acme" },
    new TenantDescriptor<Guid> { TenantId = Guid.Parse("5b7e9a20-1c4d-4e8f-b2a6-7d3e1f9c0a02"), Name = "Globex" },
]);
```

It is a singleton built when registered; it does not see later changes. The key type's default (`Guid.Empty`, `0`, an
empty string) is reserved for "no tenant" and throws as a tenant id.

## An existing table: a store over it

When the app has an `Organisation` (or `Account`, `Customer`) table, that table is the registry. Project it to a
descriptor so the store never tracks entities:

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;

public sealed record OrganisationTenant(Guid TenantId, string Name, bool IsActive) : ITenantDescriptor<Guid>;

public sealed class OrganisationTenantStore(AppDbContext db) : ITenantStore<Guid>
{
    public async ValueTask<ITenantDescriptor<Guid>?> GetTenantAsync(Guid tenantId, CancellationToken ct = default) =>
        await db.Organisations.AsNoTracking()
            .Where(o => o.Id == tenantId)
            .Select(o => new OrganisationTenant(o.Id, o.Name, o.IsActive))
            .SingleOrDefaultAsync(ct);

    public async ValueTask<IReadOnlyList<ITenantDescriptor<Guid>>> GetAllTenantsAsync(CancellationToken ct = default) =>
        await db.Organisations.AsNoTracking()
            .Select(o => new OrganisationTenant(o.Id, o.Name, o.IsActive))
            .ToListAsync<ITenantDescriptor<Guid>>(ct);
}
```

```csharp
tenant.UseStore<OrganisationTenantStore>();
```

- `Organisation` must not implement `ITenantEntity<TKey>`. With no tenant current, the filter would hide every row
  from the store, and no request could ever resolve a tenant.
- `UseStore<T>()` registers the store as scoped, so it can use a scoped `DbContext`. Singletons, such as hosted
  services, read tenants through `ITenantLookup<TKey>`, never by injecting the store.
- Return every tenant from `GetAllTenantsAsync`, suspended ones included: tools that work through every tenant need
  them. Refuse suspended tenants with `ValidateTenantActivity` (below).

## Requests that name a tenant by something other than its id

With `Guid` or `int` keys, a subdomain or slug is not the id. Implement `FindByIdentifierAsync` to map it:

```csharp
public async ValueTask<ITenantDescriptor<Guid>?> FindByIdentifierAsync(string identifier, CancellationToken ct = default) =>
    await db.Organisations.AsNoTracking()
        .Where(o => o.Slug == identifier)
        .Select(o => new OrganisationTenant(o.Id, o.Name, o.IsActive))
        .SingleOrDefaultAsync(ct);
```

The subdomain and host resolvers return lower case. A store that wraps another store must forward this method too.

## Suspended tenants

```csharp
tenant.ValidateTenantActivity(t => t is OrganisationTenant { IsActive: true });
```

Check for the active state rather than the suspended one, so a descriptor of another type is refused. A suspended
tenant's requests get `403` where a tenant is required, and `RunInScopeAsync` throws `TenantInactiveException`.

When the check needs services, implement `ITenantActivityValidator<TKey>` and add it with
`tenant.ValidateTenantActivity<TValidator>()`, which registers it as a singleton. It cannot take a scoped service such
as a `DbContext` in its constructor: create a scope inside it. Do not register the validator yourself as scoped or
transient: `ITenantActivity<TKey>` then throws when it is first resolved.

## Caching

The middleware looks the tenant up on every request. To avoid a database read each time:

```csharp
tenant.CacheTenants(o => o.Duration = TimeSpan.FromMinutes(1));   // 5 minutes by default
```

When a tenant is suspended, renamed or deleted, call `ITenantInvalidator<TKey>.InvalidateAsync(tenantId)`, or the
cached copy is served until it expires. Each instance of the app has its own cache. With several instances, publish
each invalidation to the others with `tenant.BroadcastInvalidations(...)`
(https://tenantry.dev/docs/core/tenant-stores#several-instances), or, with Tenantry Pro on MassTransit,
`pro.BroadcastInvalidationsOverMassTransit()`.

More: https://tenantry.dev/docs/core/tenant-stores
