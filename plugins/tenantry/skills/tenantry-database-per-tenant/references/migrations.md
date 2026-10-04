# Migrations and new tenant databases

## Generating migrations

`dotnet ef` creates the context with no tenant current, and a context registered with
`AddDbContextPerTenantDatabase` cannot be created without one. Give the tools a design-time factory, in the project
that holds the context:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

public sealed class AppDbContextDesignTimeFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlServer("Server=localhost;Database=app_design;Integrated Security=true;TrustServerCertificate=true")
        .UseTenantry()   // keeps the model, and so the snapshot, the same as at run time
        .Options);
}
```

`dotnet ef migrations add` needs no database, only the model; the connection string here is used by
`dotnet ef database update`, which updates that one database, not the tenants'. Calling `UseTenantry()` without the
application's services is fine at design time: only querying and saving need them.

## Applying migrations to every tenant's database

Tenantry Core has no migration runner: loop over the tenants and migrate each in its own scope. Run it as a deployment
step, once, before the new version serves requests, not on every instance at startup:

```csharp
using var host = builder.Build();

if (args.Contains("migrate-tenant-databases"))
{
    var scopes = host.Services.GetRequiredService<ITenantScopeFactory<string>>();
    var tenants = host.Services.GetRequiredService<ITenantLookup<string>>();

    // Every tenant, suspended ones included: their schema must keep up too.
    foreach (var tenant in await tenants.GetAllTenantsAsync())
    {
        await using var scope = scopes.CreateScope(tenant);
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    }

    return 0;
}

host.Run();
return 0;
```

`MigrateAsync` creates a database that does not exist yet, on providers that can (SQL Server, PostgreSQL, SQLite),
when the login may create databases. This loop stops at the first failure and runs one tenant at a time. Tenantry Pro,
a paid package, adds a runner with per-tenant failure reporting, exit codes for CI, concurrency and canary runs
(`dotnet run -- migrate-tenants`), and provisioning that creates, migrates and seeds a new tenant's database in one
call: see the `tenantry-pro` skill.

## A new tenant

1. Add the tenant to the store, not yet active if the app suspends tenants.
2. Create and migrate its database: `CreateScope(tenant)` as above, then `Database.MigrateAsync()`.
3. Seed it inside the same scope, then activate the tenant.

`RunInScopeAsync` refuses an inactive tenant, so steps 2 and 3 use `CreateScope` with the descriptor you just added.

## Removing a tenant

Drop its database with the database's own tools, after exporting what must be kept, then remove the tenant from the
store and call `ITenantInvalidator<TKey>.InvalidateAsync(tenantId)` so no cached copy is served.

More: https://tenantry.dev/docs/core/efcore-integration#migrations
