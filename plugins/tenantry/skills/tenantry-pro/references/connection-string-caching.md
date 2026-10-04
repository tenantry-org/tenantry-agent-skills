# Connection-string caching

With a database per tenant, Core's connection-string provider calls your delegate every time a context is created.
When reading it is expensive (a secrets vault, a configuration database), `pro.CacheConnectionStrings()` keeps each
tenant's connection string in memory for `Duration` (30 minutes by default).

```csharp
builder.Services.AddTenantry<string>(tenant => tenant
    .UseStore<MyTenantStore>()
    .UseConnectionStrings(opts => opts.GetConnectionStringAsync = async (t, ct) =>
        await secretsClient.GetSecretAsync($"connstr-{t.TenantId}", ct))
    .UsePro(pro => pro.CacheConnectionStrings(o => o.Duration = TimeSpan.FromMinutes(30)))
    .AddDbContextPerTenantDatabase<AppDbContext>((sp, options) => options.UseSqlServer()));
```

- It wraps the provider `UseConnectionStrings` registers (before or after `UsePro`), or one you register before
  `UsePro`. With no provider the app does not start. A provider registered after `UsePro` replaces the cache, and a
  warning at startup says so.
- When a tenant's connection details change, call `ITenantInvalidator<TKey>.InvalidateAsync(tenantId)`; after
  rotating every tenant's credentials, `InvalidateAllAsync()`. Each instance has its own cache.
- Caching does not change which reads work: with only `GetConnectionStringAsync`, synchronous reads still throw, and
  only asynchronous EF Core calls work on the scoped context.
- `Duration` must be positive; `TimeSpan.MaxValue` caches until you invalidate.

The registration of `UseConnectionStrings` and `AddDbContextPerTenantDatabase` itself is Core's: see the
`tenantry-database-per-tenant` skill.

More: https://tenantry.dev/docs/pro/database-per-tenant#caching
