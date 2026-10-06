# The isolation tests

Two tests, and the app needs both:

| Test | Runs | Proves | Does not prove |
|------|------|--------|----------------|
| The model test (below) | The app's own `DbContext`, registered through the app's own `AddAppDbContext` method, on SQLite in memory | The registration the app runs with calls `UseTenantry()`; a tenant reads only its own rows; a write naming another tenant is refused; with no tenant nothing is read or written; every unmarked entity type is one you listed as shared | How requests name a tenant, that the access validator refuses a caller, the pipeline order, or what the endpoints do |
| The request test ([request-test.md](request-test.md)) | The whole app through `WebApplicationFactory<Program>`, with its real registration, store, resolvers and validators, against a test database | Each tenant's requests see only its data; new rows are stamped with the request's tenant; a request with no tenant, an unknown tenant, or a tenant the caller may not use is refused | Raw SQL and `IgnoreQueryFilters()` paths the test does not call, and entity types its endpoints do not touch |

Neither test sees raw SQL, Dapper or `IgnoreQueryFilters()`: check those by reading the code (step 1 of the skill).

The model test only means something if it registers the context the way the app does. That is why step 7 of the
skill moves the registration into `AddAppDbContext`: the test calls the same method, so removing `UseTenantry()`
from the app's registration fails the test. Never register the context again in the test with its own
`AddDbContext(... .UseTenantry())`: such a test passes even when the app's registration has no `UseTenantry()`.

## The test project

Use the app's existing test project if it has one. Otherwise:

```bash
dotnet new xunit -o tests/MyApp.Tests
dotnet sln add tests/MyApp.Tests          # if the repository has a solution file
dotnet add tests/MyApp.Tests reference src/MyApp
dotnet add tests/MyApp.Tests package Microsoft.EntityFrameworkCore.Sqlite --version <the app's EF Core version>
dotnet add tests/MyApp.Tests package Tenantry.EfCore --version 0.8.0
```

Use the same EF Core version as the app, or the restore fails with a downgrade error. If the types the test needs are
`internal`, add `[assembly: InternalsVisibleTo("MyApp.Tests")]` to the app.

## The model test

Replace `AppDbContext`, `Order`, `Organisation`, `Guid` and the shared types with the app's own, and add a `using`
for the app's namespace. Add one write and one read for each tenant-owned entity type that matters, child types
included, building the smallest valid row: every required column set, unique columns given distinct values, and the
parents it needs added with it.

```csharp
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Tenantry;
using Tenantry.EfCore;
using Xunit;

public sealed class TenantIsolationTests
{
    private static readonly TenantDescriptor<Guid> TenantA =
        new() { TenantId = Guid.Parse("8d2c3c1e-6f0e-4a3c-9a43-0f5c2f6a1b01"), Name = "Tenant A" };
    private static readonly TenantDescriptor<Guid> TenantB =
        new() { TenantId = Guid.Parse("5b7e9a20-1c4d-4e8f-b2a6-7d3e1f9c0a02"), Name = "Tenant B" };

    // Entity types every tenant shares on purpose. A new entity type that is neither tenant-owned nor listed here
    // fails EveryEntityTypeIsTenantOwnedOrSharedOnPurpose.
    private static readonly Type[] SharedOnPurpose = [typeof(Organisation)];

    [Fact]
    public async Task ATenantReadsOnlyItsOwnRows()
    {
        await using var db = await TestDatabase.CreateAsync();
        await db.AsTenant(TenantA, ctx => ctx.Orders.Add(new Order { Reference = "A-1" }));
        await db.AsTenant(TenantB, ctx => ctx.Orders.Add(new Order { Reference = "B-1" }));

        await using var scope = db.Scopes.CreateScope(TenantA);
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        Assert.Equal(["A-1"], await context.Orders.Select(o => o.Reference).ToListAsync());
    }

    [Fact]
    public async Task AWriteThatNamesAnotherTenantIsRefused()
    {
        await using var db = await TestDatabase.CreateAsync();
        await using var scope = db.Scopes.CreateScope(TenantA);
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Entry(...).Property(...) sets TenantId even when its setter is private.
        var order = new Order { Reference = "B-2" };
        context.Orders.Add(order);
        context.Entry(order).Property(o => o.TenantId).CurrentValue = TenantB.TenantId;

        var error = await Assert.ThrowsAsync<TenantIsolationViolationException>(() => context.SaveChangesAsync());
        Assert.Equal(TenantIsolationViolationKind.EntityWrite, error.Kind);
    }

    [Fact]
    public async Task WithoutATenantNothingIsReadOrWritten()
    {
        await using var db = await TestDatabase.CreateAsync();
        await db.AsTenant(TenantA, ctx => ctx.Orders.Add(new Order { Reference = "A-1" }));

        // A plain DI scope: no tenant is current.
        await using var scope = db.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        Assert.Empty(await context.Orders.ToListAsync());
        context.Orders.Add(new Order { Reference = "X-1" });
        await Assert.ThrowsAsync<TenantNotResolvedException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task EveryEntityTypeIsTenantOwnedOrSharedOnPurpose()
    {
        await using var db = await TestDatabase.CreateAsync();
        await using var scope = db.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var unmarked = TenantModel.FindUnisolatedEntityTypes(context.Model).Select(t => t.ClrType);

        Assert.Equal(SharedOnPurpose.OrderBy(t => t.FullName), unmarked.OrderBy(t => t.FullName));
    }

    // One in-memory SQLite database with the app's model, registered by the app's own AddAppDbContext, and Tenantry
    // with the two test tenants.
    private sealed class TestDatabase : IAsyncDisposable
    {
        private readonly SqliteConnection _connection;

        private TestDatabase(SqliteConnection connection, ServiceProvider services)
        {
            _connection = connection;
            Services = services;
            Scopes = services.GetRequiredService<ITenantScopeFactory<Guid>>();
        }

        public ServiceProvider Services { get; }

        public ITenantScopeFactory<Guid> Scopes { get; }

        public static async Task<TestDatabase> CreateAsync()
        {
            // An in-memory SQLite database lasts as long as its connection is open.
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();

            var services = new ServiceCollection()
                .AddTenantry<Guid>(tenant => tenant.UseInMemoryStore([TenantA, TenantB]))
                .AddAppDbContext(options => options.UseSqlite(connection))   // the app's own registration
                .BuildServiceProvider(validateScopes: true);

            var db = new TestDatabase(connection, services);
            await using var scope = services.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await context.Database.EnsureCreatedAsync();

            // Rows that tenant-owned rows need, such as the tenant registry they reference, go here.
            context.Organisations.AddRange(
                new Organisation { Id = TenantA.TenantId, Name = TenantA.Name },
                new Organisation { Id = TenantB.TenantId, Name = TenantB.Name });
            await context.SaveChangesAsync();

            return db;
        }

        // Runs the change as the tenant, in its own scope and context, and saves it.
        public async Task AsTenant(ITenantDescriptor<Guid> tenant, Action<AppDbContext> change)
        {
            await using var scope = Scopes.CreateScope(tenant);
            var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            change(context);
            await context.SaveChangesAsync();
        }

        public async ValueTask DisposeAsync()
        {
            await Services.DisposeAsync();
            await _connection.DisposeAsync();
        }
    }
}
```

## Check that the test can fail

Remove `options.UseTenantry()` from `AddAppDbContext` and run the tests: `ATenantReadsOnlyItsOwnRows` and the others
must fail. Put the call back. A test that still passes is not testing the app's registration.

## Adapting it

- No tenant registry in the model: delete the `Organisations` seed and remove `Organisation` from `SharedOnPurpose`.
- The context's constructor takes more than its options: register those services in `CreateAsync` too.
- The model uses SQL Server or PostgreSQL features SQLite cannot create (`HasDefaultValueSql`, computed columns,
  schemas): run the same tests against the app's database in a container, for example with Testcontainers.
- On xUnit v3, pass `TestContext.Current.CancellationToken` to the async calls if the analyzers ask for it.
- `CreateScope` trusts the descriptor it is given, which suits a test that holds its own tenants. Never pass it a
  descriptor built from request input in application code.

Then write the request test: [request-test.md](request-test.md).
