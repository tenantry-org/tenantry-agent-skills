# Entities and the migration

## Which entities to mark

Mark an entity when each of its rows belongs to one tenant. Leave it unmarked when every tenant must see the same rows.

| Usually tenant-owned | Usually shared (unmarked) |
|----------------------|---------------------------|
| Orders, invoices, projects, documents, users of one tenant | Countries, currencies, plans, product catalogues shared by all |
| Child rows of those: order lines, comments, attachments | The tenant registry (`Organisation`, `Account`) |
| Join entities with their own key or payload between tenant-owned types | Membership rows that say which tenants a user belongs to |

An unmarked child of a tenant-owned entity is the most common gap: `db.OrderLines.ToListAsync()` returns every
tenant's lines, even though `db.Orders` is filtered. Mark children too.

The isolation test lists the types left unmarked on purpose, so the decision is written down and a new entity that
nobody marked fails the test.

## Marking an entity with no owner column

```csharp
using Tenantry;

public class Order : TenantEntity<Guid>   // adds public Guid TenantId { get; set; }
{
    public int Id { get; set; }
    public string Reference { get; set; } = "";
}
```

Or keep your own base class and implement the interface. The setter can be private: Tenantry sets it through EF Core.

```csharp
public class Order : AuditableEntity, ITenantEntity<Guid>
{
    public int Id { get; set; }
    public Guid TenantId { get; private set; }
}
```

## Marking an entity that already has an owner column

Rename the property to `TenantId` and keep the column name and the relationship, so no data moves:

```csharp
public class Order : ITenantEntity<Guid>
{
    public int Id { get; set; }
    public Guid TenantId { get; private set; }                 // was OrganisationId
    public Organisation? Organisation { get; private set; }
}

// In OnModelCreating
modelBuilder.Entity<Order>(order =>
{
    order.Property(o => o.TenantId).HasColumnName("OrganisationId");
    order.HasOne(o => o.Organisation).WithMany().HasForeignKey(o => o.TenantId);
});
```

A private setter makes the compiler find every line that set the owner id by hand; delete those lines. `TenantId`
must be a public mapped property of type `TKey`: implementing the interface explicitly
(`Guid ITenantEntity<Guid>.TenantId => OrganisationId`) is refused when the model is built.

## Rules the model must follow

- One key type everywhere. An `ITenantEntity<string>` in an app registered with `AddTenantry<Guid>` fails the
  model's first query or save.
- In an inheritance hierarchy, mark the root. A tenant-owned type whose base type is not tenant-owned is refused.
- Owned types (`OwnsOne`, `OwnsMany`) follow their owner and need no marking. Mark one only when it has a key of its
  own (`OwnsMany(..., b => b.HasKey(x => x.Id))`), and never one mapped with `ToJson()`.
- A many-to-many relationship with EF Core's default join entity needs nothing. A join entity of your own with a key
  that is not its two foreign keys must implement `ITenantEntity<TKey>`.
- When `TenantId` is part of the primary key, set it from `ITenantContext<TKey>.CurrentTenantId` before `Add`: EF Core
  cannot track an entity whose key is unset.
- ASP.NET Core Identity users per tenant: https://tenantry.dev/docs/core/aspnetcore-identity
- The full list of models Tenantry refuses: https://tenantry.dev/docs/core/efcore-advanced#models-that-cannot-be-isolated

## Indexes

Tenantry creates no indexes. Every query filters on `TenantId`, so lead composite indexes with it, and make unique
indexes unique per tenant unless the value must be unique across all tenants:

```csharp
modelBuilder.Entity<Order>().HasIndex(o => new { o.TenantId, o.CreatedAt });
modelBuilder.Entity<Order>().HasIndex(o => new { o.TenantId, o.Reference }).IsUnique();   // was HasIndex(o => o.Reference)
```

## The migration

```bash
dotnet ef migrations add AddTenantry
```

`dotnet ef` builds the model with no tenant current, which is fine: the filter and the `TenantId` concurrency token
change no schema. A design-time factory that builds options without the app's services can still call `UseTenantry()`.

Read the generated migration before applying it.

### When the owner column already existed

Expect no operations on the column: the model snapshot changes, because `TenantId` becomes a concurrency token, and
any index you changed is dropped and created again. EF Core also drops the single-column index of the owner's
foreign key once a composite index leads with that column, which is expected. If the migration drops, adds or renames
the owner column, the `HasColumnName` mapping is missing. If it alters the column from nullable to
required, rows with no owner exist: decide with the user which tenant they belong to and update them in the migration
before the `AlterColumn`.

### When the column is new

EF Core generates an `AddColumn` that gives existing rows the key type's default (`Guid.Empty`, `0` or `""`). Tenantry
treats that value as "no tenant", so those rows are visible to no tenant and cannot be updated. Assign them in the same
migration, after the `AddColumn` and before any index that includes the column:

```csharp
migrationBuilder.AddColumn<Guid>(
    name: "TenantId",
    table: "Orders",
    nullable: false,
    defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

// Every existing order belongs to the first customer.
migrationBuilder.Sql("""UPDATE "Orders" SET "TenantId" = '8D2C3C1E-6F0E-4A3C-9A43-0F5C2F6A1B01'""");

// Child rows take their parent's tenant.
migrationBuilder.Sql("""
    UPDATE "OrderLines" SET "TenantId" =
        (SELECT "TenantId" FROM "Orders" WHERE "Orders"."Id" = "OrderLines"."OrderId")
    """);
```

Use the parent's column name in the SQL, which is still the old one (`OrganisationId`, say) when you mapped `TenantId`
to an existing column.

Which tenant owns the existing rows is the user's decision: ask if it is not obvious (for a single-customer app, it is
usually that customer, who becomes the first tenant). Write the SQL for the app's database:

- Double-quoted names work on SQL Server, PostgreSQL and SQLite; MySQL uses backticks.
- EF Core stores a `Guid` on SQLite as upper-case text, so write the literal in upper case there. SQL Server and
  PostgreSQL accept either case.
- For `string` keys, the literal is the tenant id as text; for `int` keys, a number.

Apply it with `dotnet ef database update`, or however the app applies migrations, and check that every row has a
tenant id that is in the store:

```sql
SELECT COUNT(*) FROM "Orders" WHERE "TenantId" = '00000000-0000-0000-0000-000000000000';   -- expect 0
```

More: https://tenantry.dev/docs/core/efcore-integration#migrations
