using StackExchange.Redis;

var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
var redisHost = Environment.GetEnvironmentVariable("REDIS_HOST") ?? "localhost";
var redisPort = int.Parse(Environment.GetEnvironmentVariable("REDIS_PORT") ?? "6379");
var redisPassword = Environment.GetEnvironmentVariable("REDIS_PASSWORD") ?? "";

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

// Register Redis connection as singleton
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
{
    var options = new ConfigurationOptions
    {
        EndPoints = { { redisHost, redisPort } },
        Password = redisPassword,
        AbortOnConnectFail = false,
    };
    return ConnectionMultiplexer.Connect(options);
});

var app = builder.Build();

// --- Intentional memory leak (for observability / load testing) ---
// Each call to /leak allocates ~1MB into a static list that is never released.
var _leak = new List<byte[]>();

// --- Root ---
app.MapGet("/", () => Results.Ok(new
{
    message = "Hello from .NET on Railpack!",
    framework = "ASP.NET Core 8.0",
}));

// --- Health ---
app.MapGet("/health", () => Results.Ok(new
{
    status = "healthy",
    uptime = (DateTime.UtcNow - System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime()).ToString(),
    memoryMB = GC.GetTotalMemory(false) / 1024 / 1024,
}));

// --- Memory leak: GET /leak?mb=10 (mb is optional, defaults to 10) ---
app.MapGet("/leak", (HttpContext ctx, ILoggerFactory logFactory) =>
{
    var log = logFactory.CreateLogger("Leak");
    var mb = int.TryParse(ctx.Request.Query["mb"], out var v) ? Math.Clamp(v, 1, 500) : 10;
    var chunk = new byte[mb * 1024 * 1024];
    Random.Shared.NextBytes(chunk); // prevent compiler optimising it away
    _leak.Add(chunk);
    var totalMB = _leak.Sum(b => b.Length) / 1024 / 1024;
    log.LogWarning("[LEAK] Allocated {MB}MB — total leaked: {TotalMB}MB (chunks: {Count})", mb, totalMB, _leak.Count);
    return Results.Ok(new { allocated_mb = mb, total_leaked_mb = totalMB, chunks = _leak.Count });
}).WithName("MemoryLeak");

// --- Publish: POST /publish/{channel}  body: plain-text message ---
app.MapPost("/publish/{channel}", async (string channel, HttpRequest request, IConnectionMultiplexer redis, ILogger<Program> log) =>
{
    using var reader = new StreamReader(request.Body);
    var message = await reader.ReadToEndAsync();
    if (string.IsNullOrWhiteSpace(message))
    {
        log.LogWarning("[PUBLISH] [{Channel}] rejected — empty body", channel);
        return Results.BadRequest(new { error = "Request body must contain a message." });
    }

    log.LogInformation("[PUBLISH] [{Channel}] message='{Message}'", channel, message);
    var sub = redis.GetSubscriber();
    var receivers = await sub.PublishAsync(RedisChannel.Literal(channel), message);
    log.LogInformation("[PUBLISH] [{Channel}] delivered to {Receivers} subscriber(s)", channel, receivers);

    return Results.Ok(new { channel, message, receivers });
});

// --- Subscribe: GET /subscribe/{channel} — Server-Sent Events stream ---
app.MapGet("/subscribe/{channel}", async (string channel, HttpContext ctx, IConnectionMultiplexer redis, ILogger<Program> log) =>
{
    var clientIp = ctx.Connection.RemoteIpAddress;
    log.LogInformation("[SUBSCRIBE] [{Channel}] client {Ip} connected", channel, clientIp);

    ctx.Response.Headers["Content-Type"] = "text/event-stream";
    ctx.Response.Headers["Cache-Control"] = "no-cache";
    ctx.Response.Headers["X-Accel-Buffering"] = "no";
    await ctx.Response.Body.FlushAsync();

    var sub = redis.GetSubscriber();
    var tcs = new TaskCompletionSource();
    var msgCount = 0;

    await sub.SubscribeAsync(RedisChannel.Literal(channel), async (_, value) =>
    {
        if (ctx.RequestAborted.IsCancellationRequested) { tcs.TrySetResult(); return; }
        msgCount++;
        log.LogInformation("[SUBSCRIBE] [{Channel}] -> client {Ip} msg #{Count}: '{Value}'", channel, clientIp, msgCount, value);
        await ctx.Response.WriteAsync($"data: {value}\n\n");
        await ctx.Response.Body.FlushAsync();
    });

    ctx.RequestAborted.Register(() => tcs.TrySetResult());
    await tcs.Task;
    await sub.UnsubscribeAsync(RedisChannel.Literal(channel));
    log.LogInformation("[SUBSCRIBE] [{Channel}] client {Ip} disconnected after {Count} messages", channel, clientIp, msgCount);
});

// --- Weather forecast ---
var summaries = new[] { "Freezing", "Bracing", "Chilly", "Cool", "Mild", "Warm", "Balmy", "Hot", "Sweltering", "Scorching" };
app.MapGet("/weatherforecast", () =>
    Enumerable.Range(1, 5).Select(index => new WeatherForecast(
        DateOnly.FromDateTime(DateTime.Now.AddDays(index)),
        Random.Shared.Next(-20, 55),
        summaries[Random.Shared.Next(summaries.Length)]
    )).ToArray()
).WithName("GetWeatherForecast");

// --- Startup logs ---
var logger = app.Logger;
logger.LogInformation("Starting dotnet sample app on port {Port}", port);
logger.LogInformation("Environment: {Env}", app.Environment.EnvironmentName);
logger.LogInformation("Redis: {Host}:{Port}", redisHost, redisPort);
logger.LogInformation("Endpoints: /health | POST /publish/{{channel}} | GET /subscribe/{{channel}}");

app.Run();

record WeatherForecast(DateOnly Date, int TemperatureC, string? Summary)
{
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}
