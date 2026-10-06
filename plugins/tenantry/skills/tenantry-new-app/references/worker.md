# A new multi-tenant worker

A worker has no requests, so there is no resolution: each unit of work names its tenant (a queue message carries the
id), and the worker runs it with `ITenantScopeFactory<TKey>.RunInScopeAsync`.

## Packages

```bash
dotnet new worker -o src/MyWorker
cd src/MyWorker
dotnet add package Tenantry.Core --version 0.8.0
dotnet add package Tenantry.EfCore --version 0.8.0
dotnet add package Microsoft.EntityFrameworkCore.Sqlite        # or your provider
```

## Program.cs

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddTenantry<Guid>(tenant => tenant.UseInMemoryStore(
[
    new TenantDescriptor<Guid> { TenantId = Guid.Parse("8d2c3c1e-6f0e-4a3c-9a43-0f5c2f6a1b01"), Name = "Acme" },
    new TenantDescriptor<Guid> { TenantId = Guid.Parse("5b7e9a20-1c4d-4e8f-b2a6-7d3e1f9c0a02"), Name = "Globex" },
]));

builder.Services.AddDbContext<AppDbContext>(options => options
    .UseSqlite(builder.Configuration.GetConnectionString("App") ?? "Data Source=worker.db")
    .UseTenantry());

builder.Services.AddScoped<InvoiceHandler>();
builder.Services.AddHostedService<InvoiceConsumer>();

builder.Build().Run();
```

## The consumer

```csharp
using Tenantry;

public sealed record InvoiceRequested(Guid TenantId, string Number);

// The app's queue client, behind an interface of its own.
public interface IInvoiceQueue
{
    IAsyncEnumerable<InvoiceRequested> ReadAllAsync(CancellationToken ct);
}

public sealed class InvoiceHandler(AppDbContext db)
{
    public async Task HandleAsync(InvoiceRequested message, CancellationToken ct)
    {
        db.Invoices.Add(new Invoice { Number = message.Number });   // stamped with the message's tenant
        await db.SaveChangesAsync(ct);
    }
}

public sealed class InvoiceConsumer(IInvoiceQueue queue, ITenantScopeFactory<Guid> scopes, ILogger<InvoiceConsumer> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var message in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                // Looks the tenant up and refuses a missing or suspended one; the handler gets a fresh scope.
                await scopes.RunInScopeAsync(message.TenantId, (scope, ct) =>
                    scope.ServiceProvider.GetRequiredService<InvoiceHandler>().HandleAsync(message, ct), stoppingToken);
            }
            catch (TenantNotResolvedException ex)
            {
                // TenantNotFoundException (no such tenant) and TenantInactiveException (suspended) both derive from
                // it. Catching it keeps one message for a missing or suspended tenant from stopping the host.
                logger.LogWarning(ex, "Dropping invoice {Number} for tenant {TenantId}", message.Number, message.TenantId);
            }
        }
    }
}
```

`Invoice` is a `TenantEntity<Guid>` and `AppDbContext` a plain
`DbContext`, as in [api.md](api.md).

The rules for scopes, loops over every tenant, consumers whose framework opens the DI scope, and the test for this
worker are in the `tenantry-non-http` skill.
