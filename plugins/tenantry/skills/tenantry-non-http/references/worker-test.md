# Testing background work

Run the work the way the host runs it, by tenant id, with Tenantry's real services and the app's own `DbContext` on
SQLite in memory. The test checks that the work's rows belong to the tenant it names, that another tenant cannot see
them, and that an id the store does not have is refused.

The examples test a handler class that the worker calls for each message. If the worker does its work inline in
`ExecuteAsync`, move the per-message work into a class or method the test can call.

## The test project

```bash
dotnet new xunit -o tests/MyWorker.Tests
dotnet add tests/MyWorker.Tests reference src/MyWorker
dotnet add tests/MyWorker.Tests package Microsoft.EntityFrameworkCore.Sqlite --version <the app's EF Core version>
dotnet add tests/MyWorker.Tests package Tenantry.EfCore --version 0.8.0
```

## The test

Replace `AppDbContext`, `Invoice`, `InvoiceHandler`, `InvoiceRequested` and `Guid` with the app's own, and add a
`using` for the app's namespace.

```csharp
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Tenantry;
using Xunit;

public sealed class InvoiceWorkTests
{
    private static readonly TenantDescriptor<Guid> TenantA =
        new() { TenantId = Guid.Parse("8d2c3c1e-6f0e-4a3c-9a43-0f5c2f6a1b01"), Name = "Tenant A" };
    private static readonly TenantDescriptor<Guid> TenantB =
        new() { TenantId = Guid.Parse("5b7e9a20-1c4d-4e8f-b2a6-7d3e1f9c0a02"), Name = "Tenant B" };

    [Fact]
    public async Task TheWorkRunsAsTheTenantTheMessageNames()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var services = await BuildServicesAsync(connection);
        var scopes = services.GetRequiredService<ITenantScopeFactory<Guid>>();

        await scopes.RunInScopeAsync(TenantA.TenantId, (scope, ct) =>
            scope.ServiceProvider.GetRequiredService<InvoiceHandler>().HandleAsync(new InvoiceRequested(TenantA.TenantId, "A-1"), ct));

        var seenByA = await scopes.RunInScopeAsync(TenantA.TenantId, (scope, ct) =>
            scope.ServiceProvider.GetRequiredService<AppDbContext>().Invoices.Select(i => i.Number).ToListAsync(ct));
        var seenByB = await scopes.RunInScopeAsync(TenantB.TenantId, (scope, ct) =>
            scope.ServiceProvider.GetRequiredService<AppDbContext>().Invoices.Select(i => i.Number).ToListAsync(ct));

        Assert.Equal(["A-1"], seenByA);
        Assert.Empty(seenByB);
    }

    [Fact]
    public async Task AMessageForATenantTheStoreDoesNotHaveIsRefused()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var services = await BuildServicesAsync(connection);
        var scopes = services.GetRequiredService<ITenantScopeFactory<Guid>>();
        var unknown = Guid.Parse("11111111-1111-1111-1111-111111111111");

        var error = await Assert.ThrowsAsync<TenantNotFoundException>(() =>
            scopes.RunInScopeAsync(unknown, (scope, ct) =>
                scope.ServiceProvider.GetRequiredService<InvoiceHandler>().HandleAsync(new InvoiceRequested(unknown, "X-1"), ct)));
        Assert.Equal(unknown, error.TenantId);
    }

    // The app's DbContext on SQLite in memory, its handler, and Tenantry with the two test tenants. Register what the
    // handler needs here, as the worker's Program.cs does.
    private static async Task<ServiceProvider> BuildServicesAsync(SqliteConnection connection)
    {
        var services = new ServiceCollection()
            .AddLogging()
            .AddTenantry<Guid>(tenant => tenant.UseInMemoryStore([TenantA, TenantB]))
            .AddDbContext<AppDbContext>(options => options.UseSqlite(connection).UseTenantry())
            .AddScoped<InvoiceHandler>()
            .BuildServiceProvider(validateScopes: true);

        // CreateAsyncScope is .NET's plain DI scope and sets no tenant; creating the schema needs none.
        await using var scope = services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureCreatedAsync();
        return services;
    }
}
```

## Notes

- Make the tenant current in the test method, or in a helper the test awaits whose work runs inside it, as here. A
  tenant made current in an `async` setup method (an `InitializeAsync` that awaits) is not current when it returns.
- A worker that loops over every tenant is tested the same way: build the services, run one pass, then read as each
  tenant.
- On xUnit v3, pass `TestContext.Current.CancellationToken` to the async calls if the analyzers ask for it.

More: https://tenantry.dev/docs/core/testing
