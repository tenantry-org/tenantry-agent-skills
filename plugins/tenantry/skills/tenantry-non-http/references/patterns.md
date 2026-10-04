# Patterns

In the examples, `scopes` is an injected `ITenantScopeFactory<Guid>`, `tenants` an `ITenantLookup<Guid>`, `activity`
an `ITenantActivity<Guid>` and `setter` an `ITenantContextSetter<Guid>`. All four are registered by `AddTenantry` and
live in the `Tenantry` namespace.

## Work that starts from a tenant id

A queue message, a job's data or a command-line argument usually carries only the id:

```csharp
await scopes.RunInScopeAsync(message.TenantId, async (scope, ct) =>
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Invoices.Add(new Invoice { Number = message.Number });   // stamped with message.TenantId
    await db.SaveChangesAsync(ct);
}, cancellationToken);
```

It looks the tenant up, runs the work in a fresh DI scope with the tenant current, and disposes the scope. It throws
`TenantNotFoundException` (carrying `TenantId`) for an id the store does not have, such as a tenant deleted since the
message was queued, and `TenantInactiveException` for one `ValidateTenantActivity` refuses. Both derive from
`TenantNotResolvedException`. A consumer usually logs them and drops or dead-letters the message; catch the base type,
so a suspended tenant's message does not stop a `BackgroundService` (and with it, by default, the host):

```csharp
try
{
    await scopes.RunInScopeAsync(message.TenantId, (scope, ct) => HandleAsync(scope, message, ct), cancellationToken);
}
catch (TenantNotResolvedException ex)
{
    logger.LogWarning(ex, "Dropping message {MessageId} for tenant {TenantId}", message.Id, message.TenantId);
}
```

An overload returns the work's result:

```csharp
var count = await scopes.RunInScopeAsync(tenantId, (scope, ct) =>
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Invoices.CountAsync(ct), cancellationToken);
```

## A pass over every tenant

```csharp
public sealed class NightlyInvoiceRun(
    ITenantScopeFactory<Guid> scopes, ITenantLookup<Guid> tenants, ITenantActivity<Guid> activity)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        foreach (var tenant in await tenants.GetAllTenantsAsync(stoppingToken))
        {
            // GetAllTenantsAsync lists suspended tenants too, and CreateScope does not check them.
            if (!await activity.IsActiveAsync(tenant, stoppingToken))
                continue;

            await using var scope = scopes.CreateScope(tenant);
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Reads are filtered to this tenant and writes are stamped with it.
            await RunInvoicesAsync(db, stoppingToken);
        }
        // No tenant is current here: each scope restored the previous state when it was disposed.
    }
}
```

Disposing the scope disposes its services while the tenant is still current, then restores whichever tenant was
current before. Leave out the activity check only for work that must reach suspended tenants, such as migrations.

## Inside a scope another framework opened

A message framework that resolves your consumer from its own DI scope has already created the scoped services, so do
not open a second scope. Read the tenant from the store and make it current for the handler's work:

```csharp
public sealed class InvoiceRequestedConsumer(
    ITenantLookup<Guid> tenants, ITenantContextSetter<Guid> setter, AppDbContext db)
{
    public async Task HandleAsync(InvoiceRequested message, CancellationToken ct)
    {
        var tenant = await tenants.GetTenantAsync(message.TenantId, ct)
            ?? throw new TenantNotFoundException(message.TenantId);

        using (setter.MakeCurrent(tenant))
        {
            db.Invoices.Add(new Invoice { Number = message.Number });
            await db.SaveChangesAsync(ct);
        }
        // The previous tenant, or none, is current again here.
    }
}
```

Here the context was created before the tenant was current. That is fine with a shared database only: Tenantry reads
the tenant on each query and save, not when the context is created. It is not fine elsewhere:

- With a database per tenant (`AddDbContextPerTenantDatabase`), creating the context with no tenant current throws
  `TenantNotResolvedException`, so the framework cannot inject it. Inject `IDbContextFactory<AppDbContext>` instead
  and create the context inside the `MakeCurrent` block.
- With Tenantry Pro's schema per tenant, a context keeps the schema of the tenant that was current when its model was
  first used: one used under another tenant throws `TenantIsolationViolationException` of kind `TenantSchemaMismatch`.
  Create the context inside the `MakeCurrent` block there too. Call `MakeCurrent` in the method that does the work, not in a helper that
returns the handle. Check the tenant is active (`ITenantActivity<TKey>`) if suspended tenants' messages must not run.

`setter.MakeNoTenantCurrent()` does the opposite: code inside it sees no tenant.

## Nesting

An inner scope or `MakeCurrent` shadows the outer tenant, and the outer one is current again once the inner is
disposed:

```csharp
using (setter.MakeCurrent(acme))
{
    using (setter.MakeCurrent(globex))
    {
        // Globex
    }
    // Acme again
}
```

## Work that runs later

```csharp
queue.Enqueue(new InvoiceRequested(tenantContext.CurrentTenantId, number));   // capture the id
// ... later, in the consumer:
await scopes.RunInScopeAsync(message.TenantId, (scope, ct) => HandleAsync(scope, message, ct), ct);
```

A `Task.Run` started inside a scope inherits the tenant it had then, but the scope's services may be disposed before it
runs. Capture the id instead.

## A console tool

```csharp
using var host = builder.Build();
var scopes = host.Services.GetRequiredService<ITenantScopeFactory<Guid>>();

var tenantId = Guid.Parse(args[0]);
await scopes.RunInScopeAsync(tenantId, async (scope, ct) =>
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    Console.WriteLine(await db.Invoices.CountAsync(ct));
});
```

## Admin work across tenants

Read across tenants with `IgnoreQueryFilters()` on that query. Write as each tenant in turn, with a scope per tenant.
For maintenance code that must write without a tenant, give it a context of its own:

```csharp
using Tenantry.EfCore;

builder.Services.AddDbContext<MaintenanceDbContext>(options => options
    .UseSqlServer(connectionString)
    .UseTenantry(o => o.OnMissingTenant = MissingTenantBehavior.Allow));
```

With `Allow`, updates and deletes are not tenant-checked and new rows must set `TenantId` themselves. Keep the
application's own contexts at the default, `Reject`.

More: https://tenantry.dev/docs/core/non-http-hosts#running-work-as-a-tenant
