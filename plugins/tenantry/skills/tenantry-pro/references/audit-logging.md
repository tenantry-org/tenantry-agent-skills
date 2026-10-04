# Audit logging

`pro.AddAuditLogging()` records every insert, update and delete saved by a context that uses `UseTenantry()`, with
the tenant, the time, who made the change and the changed values, and passes the entries to an `IAuditStore` once
the changes are committed. Package: `Tenantry.Pro.EfCore`.

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;
using Tenantry.Pro.EfCore;

builder.Services.AddTenantry<string>(tenant => tenant
    .ResolveFromHeader("X-Tenant-Id")
    .UseStore<MyTenantStore>()
    .UsePro(pro => pro.AddAuditLogging(opts =>
    {
        opts.Exclude<OutboxMessage>();                          // leave a type out
        opts.ExcludeProperty<User>(user => user.PasswordHash);  // leave a property out
    })));

builder.Services.AddDbContext<AppDbContext>(options => options
    .UseSqlServer(builder.Configuration.GetConnectionString("AppDb"))
    .UseTenantry());   // audits this context's saves
```

## Who made the change

The default names no actor and uses the current trace id as the correlation id. To record the user, register an
`IAuditContextProvider`:

```csharp
using System.Diagnostics;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Tenantry.Pro.EfCore;

builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<IAuditContextProvider, HttpAuditContextProvider>();

public sealed class HttpAuditContextProvider(IHttpContextAccessor http) : IAuditContextProvider
{
    public AuditContext GetContext(DbContext context) => new()
    {
        Actor = http.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier),
        CorrelationId = Activity.Current?.TraceId.ToHexString() ?? http.HttpContext?.TraceIdentifier,
    };
}
```

## Where entries go

The default store writes each entry to the log. To persist them, implement `IAuditStore` and register it after
`AddAuditLogging()`; it can be scoped and use a `DbContext` of its own:

```csharp
builder.Services.AddDbContext<AuditDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("AppDb")));
builder.Services.AddScoped<IAuditStore, MyDatabaseAuditStore>();
```

By default (`AuditTiming.AfterCommit`) the store receives a save's entries after its changes commit, and entries of a
save or transaction that rolls back are discarded. A context that does not call `UseTenantry()` is not audited.

More, including writing entries in the same transaction and what a store failure does:
https://tenantry.dev/docs/pro/audit-logging
