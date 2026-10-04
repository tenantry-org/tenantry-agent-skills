// What the tenantry-pro skill's code blocks take for granted, on top of Ambient.cs: the application's own types they
// name without declaring. Built only with IncludePro=true.
global using static Snippets.ProAmbient;
using Hangfire;
using Microsoft.EntityFrameworkCore;
using Tenantry;
using Tenantry.Pro;

namespace Snippets;

public static class ProAmbient
{
    public static IBackgroundJobClient jobs = null!;

    public static void WithPro<TKey>(Action<IProBuilder<TKey>> configure)
        where TKey : IEquatable<TKey>, IParsable<TKey> =>
        builder.Services.AddTenantry<TKey>(tenant => tenant.UsePro(configure));
}

/// <summary>The application's own tenant type.</summary>
public class Tenant : TenantDescriptor<string>
{
    public bool IsActive { get; set; } = true;
    public bool DedicatedDatabase { get; set; }
}

public sealed class MyTenantStore : ITenantStore<string>
{
    public ValueTask<ITenantDescriptor<string>?> GetTenantAsync(string tenantId, CancellationToken ct = default) =>
        ValueTask.FromResult<ITenantDescriptor<string>?>(null);

    public ValueTask<IReadOnlyList<ITenantDescriptor<string>>> GetAllTenantsAsync(CancellationToken ct = default) =>
        ValueTask.FromResult<IReadOnlyList<ITenantDescriptor<string>>>([]);
}

public interface IMyTenantRepository
{
    Task AddAsync(Tenant tenant, CancellationToken ct);
    Task ActivateAsync(string tenantId, CancellationToken ct);
}

public sealed class MyTenantSeeder : ITenantSeeder<string>
{
    public Task SeedAsync(ITenantDescriptor<string> tenant, CancellationToken cancellationToken) => Task.CompletedTask;
}

public sealed class ExportTenantData : ITenantDeprovisioningStep<string>
{
    public Task ExecuteAsync(TenantDeprovisioningContext<string> context, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}

public class OutboxMessage
{
    public int Id { get; set; }
}

public class User
{
    public int Id { get; set; }
    public string PasswordHash { get; set; } = "";
}

public sealed class ReportJob
{
    public void Execute() { }
}

public class AuditDbContext(DbContextOptions<AuditDbContext> options) : DbContext(options);

public sealed class MyDatabaseAuditStore : Tenantry.Pro.EfCore.IAuditStore
{
    public Task SaveAsync(DbContext context, IReadOnlyList<Tenantry.Pro.EfCore.AuditEntry> entries,
        CancellationToken cancellationToken = default) => Task.CompletedTask;
}
