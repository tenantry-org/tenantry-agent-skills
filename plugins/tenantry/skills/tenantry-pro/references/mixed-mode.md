# Mixed mode

Different tenants get different isolation in one application: some their own database, some their own schema in the
shared database, some the shared tables. A delegate says which, from the tenant's descriptor.

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;
using Tenantry.Pro;

// Tenant is the app's own descriptor type. DedicatedDatabase is set when the tenant is created and never changes.
static TenantIsolation IsolationOf(ITenantDescriptor<string> t) =>
    t.As<Tenant>().DedicatedDatabase ? TenantIsolation.Database : TenantIsolation.Schema;

builder.Services.AddTenantry<string>(tenant =>
{
    tenant.ResolveFromHeader("X-Tenant-Id");
    tenant.ValidateTenantAccessByClaim("tenant_id");
    tenant.UseStore<MyTenantStore>();

    // Each tenant's connection string: its own database, or the shared one.
    tenant.UseConnectionStrings(opts => opts.GetConnectionString = t => IsolationOf(t) == TenantIsolation.Database
        ? $"Server=.;Database=app_{t.TenantId};Integrated Security=true;TrustServerCertificate=True"
        : sharedConnectionString);

    tenant.UsePro(pro =>
    {
        pro.UseMixedMode(opts => opts.GetIsolation = IsolationOf);
        pro.UseSchemaPerTenant(opts => opts.GetSchemaName = t => $"tenant_{t.TenantId}");   // Schema tenants only

        pro.AddDatabaseProvisioning<AppDbContext>()
            .AddSchemaProvisioning<AppDbContext>()
            .AddMigrations<AppDbContext>();
    });

    tenant.AddDbContextPerTenantDatabase<AppDbContext>((_, options) => options.UseSqlServer());
});
```

| `TenantIsolation` | Where the tenant's data lives |
|-------------------|-------------------------------|
| `Shared` | The shared database and schema, kept apart only by Tenantry's query filters |
| `Schema` | Its own schema of the shared database; needs `UseSchemaPerTenant` |
| `Database` | Its own database |

## Rules

- `GetIsolation` must be fast and give the same answer for a tenant every time. Moving a tenant to another isolation
  means moving its data, which Tenantry does not do, so branch on something fixed at creation, not on the plan.
- For `Shared` tenants, every entity type of the context must implement `ITenantEntity<TKey>` or be marked shared with
  `[SharedAcrossTenants]` or `modelBuilder.Entity<T>().IsSharedAcrossTenants()` (namespace `Tenantry.EfCore`).
  Otherwise the context throws `TenantIsolationViolationException` (`ModelConfiguration`) for a `Shared` tenant, and the
  host logs a warning at startup naming the types.
- Provisioning creates a database only for `Database` tenants and a schema only for `Schema` tenants; offboarding drops
  only what the tenant has, and deletes a `Shared` tenant's rows with `AddSharedDataDeletion<TContext>()`.
- Migrations and health checks run per distinct database or schema, and once for the shared database's default schema
  for all `Shared` tenants.

More: https://tenantry.dev/docs/pro/mixed-mode
