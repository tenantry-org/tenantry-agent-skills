# Registration: `UseConnectionStrings` and `AddDbContextPerTenantDatabase`

This file holds every registration detail of a database per tenant, so it is the one place to update if the
registration changes. It describes Tenantry 0.7.

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;

builder.Services.AddTenantry<string>(tenant => tenant
    .ResolveFromHeader("X-Tenant-Id")
    .ValidateTenantAccessByClaim("tenant_id")
    .UseStore<AppTenantStore>()
    .UseConnectionStrings(options =>
        options.GetConnectionString = t => $"Server=db;Database=app_{t.TenantId};Integrated Security=true")
    .AddDbContextPerTenantDatabase<AppDbContext>((sp, options) => options.UseSqlServer(), pooled: true));
```

## `UseConnectionStrings`

Says how to find a tenant's connection string. Two forms; use one of them, not both (combining them throws):

```csharp
// 1. Delegates on TenantConnectionStringOptions<TKey>
tenant.UseConnectionStrings(options =>
{
    options.GetConnectionString = t => t.As<AppTenant>().ConnectionString;            // Func<ITenantDescriptor<TKey>, string>
    options.GetConnectionStringAsync = (t, ct) => secrets.GetAsync($"db-{t.TenantId}", ct); // Func<ITenantDescriptor<TKey>, CancellationToken, ValueTask<string>>
});

// 2. A provider of your own, built from the application's services
tenant.UseConnectionStrings(sp => new VaultConnectionStrings(sp.GetRequiredService<SecretClient>()));
```

- The delegate receives the tenant as `ITenantDescriptor<TKey>`; read your own tenant type with `t.As<AppTenant>()`.
  It runs each time a context is created, so it must be fast and give the same answer every time. The default
  provider does not cache.
- With both delegates set, async reads prefer `GetConnectionStringAsync`.
- With only `GetConnectionStringAsync`, the scoped context reads its connection string when it first opens a
  connection, so only asynchronous EF Core calls (`ToListAsync`, `SaveChangesAsync`) work on it; a synchronous one
  throws `InvalidOperationException`.
- A provider of your own implements `ITenantConnectionStringProvider<TKey>` and returns `false` from
  `CanGetSynchronously` if it can only read asynchronously. It must be a singleton: the first context created throws
  when it is scoped or transient. Create a scope inside it for any scoped service it needs.
- To cache or log, wrap whichever provider is registered:
  `tenant.DecorateConnectionStrings((sp, inner) => new LoggingConnectionStrings(inner))`.

It also registers, as singletons:

- `ITenantConnectionStringProvider<TKey>`: `Get(tenant)` and `GetAsync(tenant, ct)` for a given tenant, without
  making it current.
- `CurrentTenantConnectionString<TKey>`: `Get()` and `GetAsync(ct)` for the current tenant, for code that opens its own
  connections. Throws `TenantNotResolvedException` with no tenant current.

## `AddDbContextPerTenantDatabase<TContext>`

```csharp no-compile
public static ITenantBuilder AddDbContextPerTenantDatabase<TContext>(
    this ITenantBuilder builder,
    Action<IServiceProvider, DbContextOptionsBuilder> configure,
    bool pooled = false,
    int poolSize = 1024)
    where TContext : DbContext
```

- Call `UseConnectionStrings` first, or it throws `InvalidOperationException`.
- Configure the provider without a connection string (`options.UseSqlServer()`, `UseNpgsql()`, `UseSqlite()`).
  Tenantry sets each context's connection string when the context, or a pooled context's lease, is handed out.
- It registers a scoped `TContext` and an `IDbContextFactory<TContext>`. Use it instead of `AddDbContext`,
  `AddDbContextPool`, `AddDbContextFactory` or `AddPooledDbContextFactory` for that context, and register the
  context only this way.
- It applies `UseTenantry()` before your `configure` callback. `SaveChanges` interceptors you add in the callback run
  after Tenantry's: they see new entities already stamped, and their changes are not checked.
- `pooled: true` pools contexts as `AddDbContextPool` does, so the context needs a single constructor that takes only
  its options. Unpooled, it can take other services.
- Creating a context with no current tenant throws `TenantNotResolvedException`. `dotnet ef` therefore needs a
  design-time factory (see [migrations.md](migrations.md)).
- It returns `ITenantBuilder` without its key type, so put it last in a chain or call it as a statement of its own.

## The guard

Before a context opens a connection and before every command, a guard checks that the connection was set for this
context (and, pooled, this lease) and belongs to the current tenant. A context used after a switch to another tenant,
or whose connection or connection string your code replaced, throws `TenantIsolationViolationException` of kind
`TenantDatabaseMismatch`. The guard cannot see SQL run directly on `Database.GetDbConnection()`.

## What not to do

- Do not read the connection string yourself in an `AddDbContextPool` or `AddPooledDbContextFactory` callback: it
  runs once, and every lease would keep the first tenant's database.
- Do not register the same context with `AddDbContext` as well.
- Use SQLite in-memory tenant databases only in tests.

More: https://tenantry.dev/docs/core/efcore-integration#database-per-tenant
