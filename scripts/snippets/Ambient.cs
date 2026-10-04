// What the skills' code blocks take for granted. In a Program.cs: `builder`, `app`, `args` and a connection string.
// Inside AddTenantry's lambda: `tenant` (extract.cs wraps such blocks in WithTenant). In a fragment of a worker or a
// handler: the scope factory, a DbContext, a message and so on. And the application's own types that a block uses
// without declaring. A block's own declarations win over these, because its namespace is nested inside this one.
global using static Snippets.Ambient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Tenantry;

namespace Snippets;

public static class Ambient
{
    public static string[] args = [];
    public static WebApplicationBuilder builder = null!;
    public static WebApplication app = null!;
    public static IServiceCollection services = null!;
    public static IServiceProvider sp = null!;
    public static CancellationToken ct, cancellationToken;
    public static string connectionString = "", sharedConnectionString = "";
    public static ILogger logger = null!;

    public static ITenantDescriptor<Guid> acme = null!, globex = null!;
    public static Guid tenantId;
    public static ITenantContextSetter<Guid> setter = null!;
    public static ITenantContext<Guid> tenantContext = null!;
    public static ITenantScopeFactory<Guid> scopes = null!;
    public static ITenantLookup<Guid> tenants = null!;
    public static ITenantActivity<Guid> activity = null!;
    public static AppDbContext db = null!;
    public static ModelBuilder modelBuilder = null!;
    public static MigrationBuilder migrationBuilder = null!;
    public static SecretClient secrets = new(), secretsClient = new();
    public static InvoiceRequested message = null!;
    public static InvoiceQueue queue = new();
    public static string number = "";

    public static void WithTenant<TKey>(Action<ITenantBuilder<TKey>> configure)
        where TKey : IEquatable<TKey>, IParsable<TKey> =>
        builder.Services.AddTenantry(configure);

    public static Task HandleAsync(ITenantScope<Guid> scope, InvoiceRequested message, CancellationToken ct) =>
        Task.CompletedTask;
    public static Task RunInvoicesAsync(AppDbContext db, CancellationToken ct) => Task.CompletedTask;
}

public static class AppDataRegistration
{
    // The registration the add-to-existing-app skill has the app move into a method of its own.
    public static IServiceCollection AddAppDbContext(
        this IServiceCollection services, Action<DbContextOptionsBuilder> useDatabase) =>
        services.AddDbContext<AppDbContext>(options =>
        {
            useDatabase(options);
            options.UseTenantry();
        });
}

/// <summary>The application's entry point, as <c>WebApplicationFactory&lt;Program&gt;</c> names it.</summary>
public partial class Program;

public sealed record InvoiceRequested(Guid TenantId, string Number)
{
    public Guid Id { get; init; }
}

public sealed class InvoiceQueue
{
    public void Enqueue(InvoiceRequested message) { }
}

public sealed class InvoiceHandler(AppDbContext db)
{
    public Task HandleAsync(InvoiceRequested message, CancellationToken ct) => db.SaveChangesAsync(ct);
}

/// <summary>An application's own base class for entities.</summary>
public abstract class AuditableEntity
{
    public DateTime CreatedAt { get; set; }
}

public class Organisation
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Slug { get; set; } = "";
    public bool IsActive { get; set; } = true;
}

public class Membership
{
    public int Id { get; set; }
    public string? UserId { get; set; }
    public Guid OrganisationId { get; set; }
}

public class Order : TenantEntity<Guid>
{
    public int Id { get; set; }
    public string Reference { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public class OrderLine : TenantEntity<Guid>
{
    public int Id { get; set; }
    public int OrderId { get; set; }
}

public class Invoice : TenantEntity<Guid>
{
    public int Id { get; set; }
    public string Number { get; set; } = "";
}

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Organisation> Organisations => Set<Organisation>();
    public DbSet<Membership> Memberships => Set<Membership>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLine> OrderLines => Set<OrderLine>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
}

public class MaintenanceDbContext(DbContextOptions<MaintenanceDbContext> options) : DbContext(options);

public sealed class OrganisationTenantStore : ITenantStore<Guid>
{
    public ValueTask<ITenantDescriptor<Guid>?> GetTenantAsync(Guid tenantId, CancellationToken ct = default) =>
        ValueTask.FromResult<ITenantDescriptor<Guid>?>(null);

    public ValueTask<IReadOnlyList<ITenantDescriptor<Guid>>> GetAllTenantsAsync(CancellationToken ct = default) =>
        ValueTask.FromResult<IReadOnlyList<ITenantDescriptor<Guid>>>([]);
}

public sealed class AppTenantStore : ITenantStore<string>
{
    public ValueTask<ITenantDescriptor<string>?> GetTenantAsync(string tenantId, CancellationToken ct = default) =>
        ValueTask.FromResult<ITenantDescriptor<string>?>(null);

    public ValueTask<IReadOnlyList<ITenantDescriptor<string>>> GetAllTenantsAsync(CancellationToken ct = default) =>
        ValueTask.FromResult<IReadOnlyList<ITenantDescriptor<string>>>([]);
}

/// <summary>An application's own tenant type.</summary>
public class AppTenant : ITenantDescriptor<string>
{
    public string TenantId { get; set; } = "";
    public string Name { get; set; } = "";
    public string ConnectionString { get; set; } = "";
}

/// <summary>Finbuckle's EF Core store context, after the migrate-from-finbuckle skill's step 3.</summary>
public class TenantStoreDbContext(DbContextOptions<TenantStoreDbContext> options) : DbContext(options);

/// <summary>A connection-string provider over a secrets client.</summary>
public sealed class VaultConnectionStrings(SecretClient secrets) : ITenantConnectionStringProvider<string>
{
    public bool CanGetSynchronously => false;

    public string Get(ITenantDescriptor<string> tenant) => throw new NotSupportedException();

    public ValueTask<string> GetAsync(ITenantDescriptor<string> tenant, CancellationToken ct = default) =>
        secrets.GetAsync($"db-{tenant.TenantId}", ct);
}

/// <summary>A decorator that logs each connection string read.</summary>
public sealed class LoggingConnectionStrings(ITenantConnectionStringProvider<string> inner) : ITenantConnectionStringProvider<string>
{
    public bool CanGetSynchronously => inner.CanGetSynchronously;

    public string Get(ITenantDescriptor<string> tenant) => inner.Get(tenant);

    public ValueTask<string> GetAsync(ITenantDescriptor<string> tenant, CancellationToken ct = default) => inner.GetAsync(tenant, ct);
}

/// <summary>A secrets client, as Azure Key Vault's or AWS Secrets Manager's.</summary>
public sealed class SecretClient
{
    public ValueTask<string> GetAsync(string name, CancellationToken ct = default) => ValueTask.FromResult("");
    public Task<string> GetSecretAsync(string name, CancellationToken ct = default) => Task.FromResult("");
}
