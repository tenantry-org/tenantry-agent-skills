# Moving the EF Core setup

## The context

Before, with Finbuckle's interface:

```csharp no-compile
public class AppDbContext : DbContext, IMultiTenantDbContext
{
    public AppDbContext(IMultiTenantContextAccessor accessor, DbContextOptions<AppDbContext> options)
        : base(options) => TenantInfo = accessor.MultiTenantContext.TenantInfo;

    public ITenantInfo? TenantInfo { get; }
    public TenantMismatchMode TenantMismatchMode => TenantMismatchMode.Throw;
    public TenantNotSetMode TenantNotSetMode => TenantNotSetMode.Throw;
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Order>().HasIndex(o => o.Reference).IsUnique();
        modelBuilder.Entity<Order>().IsMultiTenant().AdjustUniqueIndexes();
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        this.EnforceMultiTenant();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }
}
```

After, with `UseTenantry()` where the context is registered:

```csharp
using Microsoft.EntityFrameworkCore;
using Tenantry;

public class Order : TenantEntity<string>
{
    public int Id { get; set; }
    public string Reference { get; set; } = "";
}

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // The index AdjustUniqueIndexes() added TenantId to, with the name and columns it has now.
        modelBuilder.Entity<Order>().HasIndex(o => new { o.Reference, o.TenantId }).IsUnique()
            .HasDatabaseName("IX_Orders_Reference");
    }
}
```

A context that derived from Finbuckle's base class derives from `DbContext`, with the same constructor change.

## The TenantId column

Finbuckle adds `TenantId` as a shadow property, or uses an existing `string TenantId` property. Tenantry needs a public
property: `TenantEntity<string>` provides one, and an entity that already has one implements `ITenantEntity<string>`
(its setter can be private). Either maps to the column Finbuckle created.

## Keys and indexes

`AdjustKey`, `AdjustIndex`, `AdjustIndexes` and `AdjustUniqueIndexes` added `TenantId` to keys and indexes. Tenantry
adds none. Declare each one with its current name and columns, as above; otherwise the next migration drops `TenantId`
from them, and a unique index becomes unique across every tenant. Read the database's current index names from the
latest migration or the model snapshot.

When `TenantId` is part of the primary key, set it to `ITenantContext<string>.CurrentTenantId` before `Add`. EF Core
cannot track an entity whose key is null, and Tenantry stamps `TenantId` only when saving.

## The migration

```bash
dotnet ef migrations add MoveToTenantry --context AppDbContext
```

It should contain no operations. The model snapshot still changes, because Tenantry makes `TenantId` a concurrency
token, which changes no column. If the migration:

- drops or recreates an index: declare that index as it is now (name and columns);
- makes `TenantId` nullable: the project does not use nullable reference types; add
  `modelBuilder.Entity<Order>().Property(o => o.TenantId).IsRequired()`;
- adds a column: an entity's `TenantId` property does not match the column Finbuckle created.

## The rest of the context's code

- A design-time factory (`IDesignTimeDbContextFactory`) drops its placeholder tenant, since `dotnet ef` builds the
  model with no tenant current, and calls `UseTenantry()` on the options it builds, so the model it gives the tools,
  and so the snapshot, has `TenantId` as a concurrency token as the app's does:

  ```csharp
  using Microsoft.EntityFrameworkCore.Design;

  public sealed class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
  {
      public AppDbContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<AppDbContext>()
          .UseSqlServer("Server=localhost;Database=app_design;Integrated Security=true;TrustServerCertificate=true")
          .UseTenantry()
          .Options);
  }
  ```

  Without a factory, `dotnet ef` builds the app's host and uses its registration, which already calls `UseTenantry()`.
- Code that ignored Finbuckle's named filter names `TenantryQueryFilters.Tenant` instead (EF Core 10).
- Code that created a context per tenant with Finbuckle's static `Create` uses
  `ITenantScopeFactory<string>.CreateScope(tenant)` and resolves the context from the scope. Like `Create`, it trusts
  the tenant it is given; code that has only an id uses `RunInScopeAsync`, which looks it up.
