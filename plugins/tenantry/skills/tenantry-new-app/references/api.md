# A new multi-tenant API

A shared database, `Guid` tenant ids, the tenant named in the `X-Tenant-Id` header and checked against the caller's
`tenant_id` claims, and two tenants in an in-memory store to start. Swap the provider, the store and the names for the
user's own.

## Packages

```bash
dotnet new webapi -o src/MyApp
cd src/MyApp
dotnet add package Tenantry.AspNetCore --version 0.8.0
dotnet add package Tenantry.EfCore --version 0.8.0
dotnet add package Microsoft.EntityFrameworkCore.Sqlite        # or SqlServer, Npgsql
dotnet add package Microsoft.EntityFrameworkCore.Design        # for dotnet ef
dotnet add package Microsoft.AspNetCore.Authentication.JwtBearer
```

Use the EF Core and ASP.NET Core package versions of the target framework's major (10.x for `net10.0`).

## Data.cs

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;

// Tenant-owned: filtered to the current tenant and stamped on insert.
public class Project : TenantEntity<Guid>
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public List<WorkItem> Items { get; set; } = [];
}

// A child row is tenant-owned too, or its set would return every tenant's rows.
public class WorkItem : TenantEntity<Guid>
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public int ProjectId { get; set; }
}

// Shared by every tenant on purpose.
public class Country
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
}

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<WorkItem> WorkItems => Set<WorkItem>();
    public DbSet<Country> Countries => Set<Country>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Project>().HasIndex(p => new { p.TenantId, p.Name }).IsUnique();   // unique per tenant
        modelBuilder.Entity<WorkItem>().HasIndex(i => new { i.TenantId, i.ProjectId });
    }
}
```

## Program.cs

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddAuthentication().AddJwtBearer();   // configure the issuer and audience as usual
builder.Services.AddAuthorization();
builder.Services.AddProblemDetails();                  // problem+json bodies for Tenantry's 400, 403 and 404

builder.Services.AddTenantry<Guid>(tenant => tenant
    .ResolveFromHeader("X-Tenant-Id")
    .ValidateTenantAccessByClaim("tenant_id")          // the caller's tenant_id claims must name the tenant
    .RequireTenantByDefault()
    .UseInMemoryStore(
    [
        new TenantDescriptor<Guid> { TenantId = Guid.Parse("8d2c3c1e-6f0e-4a3c-9a43-0f5c2f6a1b01"), Name = "Acme" },
        new TenantDescriptor<Guid> { TenantId = Guid.Parse("5b7e9a20-1c4d-4e8f-b2a6-7d3e1f9c0a02"), Name = "Globex" },
    ]));

builder.Services.AddDbContext<AppDbContext>(options => options
    .UseSqlite(builder.Configuration.GetConnectionString("App") ?? "Data Source=app.db")
    .UseTenantry());

var app = builder.Build();

app.UseAuthentication();
app.UseAuthorization();   // before UseTenantry, so an anonymous caller gets 401
app.UseTenantry();

app.MapGet("/health", () => "ok").AllowMissingTenant();

app.MapGet("/projects", async (AppDbContext db) =>
    await db.Projects.Select(p => new { p.Id, p.Name }).ToListAsync())
    .RequireAuthorization();

app.MapPost("/projects", async (AppDbContext db, string name) =>
{
    db.Projects.Add(new Project { Name = name });   // TenantId is stamped on save
    await db.SaveChangesAsync();
    return Results.Created();
}).RequireAuthorization();

app.Run();
```

Then create the schema:

```bash
dotnet tool install --local dotnet-ef --version <the EF Core version>   # once, after dotnet new tool-manifest
dotnet ef migrations add Initial
dotnet ef database update
```

To list tenants in a table instead, write an `ITenantStore<Guid>` over it and register it with `UseStore<T>()`. The
tenant entity must not implement `ITenantEntity<TKey>`. See https://tenantry.dev/docs/core/tenant-stores.

## The isolation test

```bash
dotnet new xunit -o tests/MyApp.Tests
dotnet add tests/MyApp.Tests reference src/MyApp
dotnet add tests/MyApp.Tests package Microsoft.EntityFrameworkCore.Sqlite --version <the app's EF Core version>
dotnet add tests/MyApp.Tests package Tenantry.EfCore --version 0.8.0
```

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

    // Entity types every tenant shares on purpose.
    private static readonly Type[] SharedOnPurpose = [typeof(Country)];

    [Fact]
    public async Task ATenantReadsOnlyItsOwnRowsAndNothingWithoutATenant()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var services = new ServiceCollection()
            .AddTenantry<Guid>(tenant => tenant.UseInMemoryStore([TenantA, TenantB]))
            .AddDbContext<AppDbContext>(options => options.UseSqlite(connection).UseTenantry())
            .BuildServiceProvider(validateScopes: true);
        var scopes = services.GetRequiredService<ITenantScopeFactory<Guid>>();

        await using (var scope = services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureCreatedAsync();

        foreach (var tenant in new[] { TenantA, TenantB })
        {
            await using var scope = scopes.CreateScope(tenant);
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Projects.Add(new Project { Name = tenant.Name, Items = [new WorkItem { Title = tenant.Name }] });
            await db.SaveChangesAsync();
        }

        await using (var scope = scopes.CreateScope(TenantA))
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(["Tenant A"], await db.Projects.Select(p => p.Name).ToListAsync());
            Assert.Equal(["Tenant A"], await db.WorkItems.Select(i => i.Title).ToListAsync());
            Assert.Equal(
                SharedOnPurpose.OrderBy(t => t.FullName),
                TenantModel.FindUnisolatedEntityTypes(db.Model).Select(t => t.ClrType).OrderBy(t => t.FullName));
        }

        await using (var scope = services.CreateAsyncScope())   // a plain DI scope: no tenant
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Empty(await db.Projects.ToListAsync());
            db.Projects.Add(new Project { Name = "None" });
            await Assert.ThrowsAsync<TenantNotResolvedException>(() => db.SaveChangesAsync());
        }
    }
}
```

The `tenantry-add-to-existing-app` skill's isolation test splits these checks into separate tests and adds the
cross-tenant write; either shape works. To test requests with tokens, see
https://tenantry.dev/docs/core/testing#requests-webapplicationfactory.
