# Behaviour that changes

| Situation | Finbuckle.MultiTenant | Tenantry |
|-----------|-----------------------|----------|
| An entity attached in tenant B's context with tenant A's key | With `EnforceMultiTenantOnTracking`, it gets B's `TenantId` and passes, so the save overwrites A's row and moves it to B | The stored `TenantId` is in every `UPDATE` and `DELETE`, so the save matches no row and throws `DbUpdateConcurrencyException` |
| Reading with no tenant | The query filter throws `NullReferenceException` | Queries return no rows |
| Writing with no tenant | Throws `MultiTenantException` | Throws `TenantNotResolvedException`; one context can allow it with `OnMissingTenant` |
| A write that names another tenant | `TenantMismatchMode` can throw, overwrite or ignore | Always throws `TenantIsolationViolationException` |
| An `ExecuteUpdate` that sets `TenantId` | Not checked | Throws |
| When the context reads the tenant | In its constructor, and keeps it | On each query and save, so pooled contexts work. Use a context for one tenant: after a switch, `Find` and `Local` can return the previous tenant's entities |
| An identifier no store knows | The next strategy is tried | The first identifier a resolver returns is used; if the store does not know it, the request has no tenant |
| Identifier case | The in-memory and configuration stores ignore case | The default lookup compares `string` ids exactly, and the subdomain and host resolvers return lower case |
| A request with no tenant, with short-circuiting on | Ends the request without an error status | `RequireTenantByDefault()` answers `400`, an unknown tenant `404`, a refused one `403`; handle `OnRejected` to redirect |
| A cookie signed in under another tenant | Treated as signed out | Add the tenant id as a claim at sign-in and validate it with `ValidateTenantAccessByClaim`; the request gets `403` |

## Code that relied on `TenantMismatchMode` or `TenantNotSetMode`

Maintenance code that writes across tenants on purpose gets a context of its own:

```csharp
using Tenantry.EfCore;

builder.Services.AddDbContext<MaintenanceDbContext>(options => options
    .UseSqlServer(connectionString)
    .UseTenantry(o => o.OnMissingTenant = MissingTenantBehavior.Allow));
```

It runs with no tenant current. Updates and deletes are then not tenant-checked, and a new row must set `TenantId`
itself. Or run the work one tenant at a time with `ITenantScopeFactory<string>`.

## Tests

- Tests that expected an exception from a query with no tenant now expect empty results.
- Tests that set the tenant through Finbuckle's accessor make it current with `ITenantScopeFactory<string>.CreateScope`
  in the test method itself.

Tenantry also refuses to build a model that cannot be isolated, such as a tenant-owned type whose base type is not
tenant-owned: https://tenantry.dev/docs/core/efcore-advanced#models-that-cannot-be-isolated
