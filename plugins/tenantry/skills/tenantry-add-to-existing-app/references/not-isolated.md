# What Tenantry does not isolate

Tenantry isolates tenants inside EF Core: its queries, `SaveChanges`, `ExecuteUpdate` and `ExecuteDelete`. It is not
row-level security in the database. Anything that reaches the database another way is not checked.

| Code | Isolated | What to do |
|------|----------|------------|
| LINQ queries on tenant-owned entities | Yes | Nothing |
| `SaveChanges` inserts, updates, deletes | Yes | Nothing. Load an entity before changing it |
| `ExecuteUpdate`, `ExecuteDelete` | Yes, filtered to the current tenant; setting `TenantId` throws | Nothing |
| `FromSql`, `FromSqlRaw`, `FromSqlInterpolated` on a tenant-owned entity | Yes: the filter is applied over your SQL | SQL that cannot be composed over, such as a stored procedure call, throws |
| `Database.SqlQuery`, `SqlQueryRaw`, `ExecuteSql`, `ExecuteSqlRaw`, `ExecuteSqlInterpolated` | No | Add `WHERE "TenantId" = {tenantId}` yourself, with the id from `ITenantContext<TKey>` |
| `IgnoreQueryFilters()` | No, by design | Keep it to admin and reporting code behind authorization. With `ExecuteUpdate` or `ExecuteDelete` it affects every tenant |
| `Database.GetDbConnection()`, Dapper, ADO.NET | No | Add the tenant predicate yourself |
| A context whose options do not call `UseTenantry()` | No | Add the call to its registration |
| Entities already tracked by a context (`Find`, `Local`) after a tenant switch | No | Use one context per tenant |

Raw SQL with the tenant added:

```csharp
public sealed class OrderTotals(AppDbContext db, ITenantContext<Guid> tenants)
{
    public Task<List<decimal>> TotalsAsync(CancellationToken ct) =>
        db.Database
            .SqlQuery<decimal>($"""SELECT "Total" FROM "Orders" WHERE "TenantId" = {tenants.CurrentTenantId}""")
            .ToListAsync(ct);
}
```

Check `tenants.HasTenant` first where the code can run without a tenant: `CurrentTenantId` is then the key type's
default, which matches no rows but does not throw.

`IgnoreQueryFilters()` removes every filter on that query. On EF Core 10, remove only the tenant filter and keep your
own (soft delete, say):

```csharp
db.Orders.IgnoreQueryFilters([TenantryQueryFilters.Tenant])
```

When the database itself must enforce isolation, for example against direct SQL access, add row-level security in the
database as well, or give each tenant its own database (`tenantry-database-per-tenant`).

More: https://tenantry.dev/docs/core/efcore-integration#what-is-and-isnt-isolated
