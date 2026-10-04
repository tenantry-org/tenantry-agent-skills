# Schema per tenant

All tenants share one database; each has its own schema (`tenant_acme.Orders`). SQL Server and PostgreSQL only;
MySQL has no schemas apart from databases, so use a database per tenant there. Entities need no tenant column, though
Core's filter still applies to any that implement `ITenantEntity<TKey>`.

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;
using Tenantry.Pro;

builder.Services.AddTenantry<string>(tenant =>
{
    tenant.ResolveFromHeader("X-Tenant-Id");
    tenant.ValidateTenantAccessByClaim("tenant_id");
    tenant.UseStore<MyTenantStore>();

    tenant.UsePro(pro => pro
        .UseSchemaPerTenant(o => o.GetSchemaName = t => $"tenant_{t.TenantId}")
        .AddSchemaProvisioning<AppDbContext>()     // provisioning creates the schema
        .AddMigrations<AppDbContext>());           // and applies the migrations in it
});

// Against the shared database. UseTenantry() is what gives the context the tenant's schema.
builder.Services.AddDbContext<AppDbContext>(options => options
    .UseSqlServer(builder.Configuration.GetConnectionString("AppDb"))
    .UseTenantry());
```

## Rules

- The `DbContext` names no schema: no `HasDefaultSchema`, and no schema in `ToTable` for tenant tables. The tenant's
  schema becomes the default after `OnModelCreating`.
- `GetSchemaName` must be fast and give a tenant the same name every time. An empty name, control characters or a name
  longer than the database allows fails that tenant's queries.
- A context used with no tenant throws `TenantNotResolvedException` on its first query, command or save. A context
  keeps the schema of the tenant current when its model was built; used under another tenant it throws
  `TenantIsolationViolationException` (`TenantSchemaMismatch`). Create a context per tenant, in its scope.
- The schema-per-tenant context cannot be pooled: `AddDbContextPool`, `AddPooledDbContextFactory` and
  `AddDbContextPerTenantDatabase(..., pooled: true)` throw. Use `AddDbContext` or `AddDbContextFactory`.
- With more than one context that calls `UseTenantry()`, list those that get the schema:
  `o.Contexts.Add(typeof(AppDbContext))`. With none listed, the host refuses to start.
- EF Core compiles a model per schema. Pro keeps `MaxCachedSchemas` (500) schemas and `MaxCompiledQueriesPerSchema`
  (100) queries each per context type; raise them for more tenants in use at once, within the memory budget.
  `UseMemoryCache` and replacing `IModelCacheKeyFactory` on these contexts are refused.

## Migrations

Generate them as usual (`dotnet ef migrations add`); the tools have no tenant, so the migrations name no schema, and
Pro applies them in each tenant's schema with its own `__EFMigrationsHistory` there. SQL in `migrationBuilder.Sql(...)`
is applied as written, so unqualified names in it resolve to the database's default schema: keep tenant migrations to
EF Core's operations. `dotnet ef database update` has no tenant and throws; migrate tenants with the runner
([migrations.md](migrations.md)).

To drop a tenant's schema when it leaves, add `pro.AddSchemaDeprovisioning<AppDbContext>()`
([lifecycle.md](lifecycle.md)).

More: https://tenantry.dev/docs/pro/schema-per-tenant
