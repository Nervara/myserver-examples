using StackExchange.Redis;

var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
var redisUrl = Environment.GetEnvironmentVariable("REDIS_URL") ?? "redis://localhost:6379";

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
builder.Services.AddOpenApi();

// Register Redis connection as singleton
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
{
    var options = ConfigurationOptions.Parse(redisUrl);
    return ConnectionMultiplexer.Connect(options);
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// --- Health ---
app.MapGet("/health", () => Results.Ok(new
{
    status = "healthy",
    uptime = (DateTime.UtcNow - System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime()).ToString()
}));

// --- Publish: POST /publish/{channel}  body: plain-text message ---
app.MapPost("/publish/{channel}", async (string channel, HttpRequest request, IConnectionMultiplexer redis) =>
{
    using var reader = new StreamReader(request.Body);
    var message = await reader.ReadToEndAsync();
    if (string.IsNullOrWhiteSpace(message))
        return Results.BadRequest(new { error = "Request body must contain a message." });

    var sub = redis.GetSubscriber();
    var receivers = await sub.PublishAsync(RedisChannel.Literal(channel), message);

    return Results.Ok(new { channel, message, receivers });
});

// --- Subscribe: GET /subscribe/{channel} — Server-Sent Events stream ---
app.MapGet("/subscribe/{channel}", async (string channel, HttpContext ctx, IConnectionMultiplexer redis) =>
{
    ctx.Response.Headers["Content-Type"] = "text/event-stream";
    ctx.Response.Headers["Cache-Control"] = "no-cache";
    ctx.Response.Headers["X-Accel-Buffering"] = "no";
    await ctx.Response.Body.FlushAsync();

    var sub = redis.GetSubscriber();
    var tcs = new TaskCompletionSource();

    await sub.SubscribeAsync(RedisChannel.Literal(channel), async (_, value) =>
    {
        if (ctx.RequestAborted.IsCancellationRequested) { tcs.TrySetResult(); return; }
        await ctx.Response.WriteAsync($"data: {value}\n\n");
        await ctx.Response.Body.FlushAsync();
    });

    ctx.RequestAborted.Register(() => tcs.TrySetResult());
    await tcs.Task;
    await sub.UnsubscribeAsync(RedisChannel.Literal(channel));
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
logger.LogInformation("Redis URL: {RedisUrl}", redisUrl);
logger.LogInformation("Endpoints: /health | POST /publish/{{channel}} | GET /subscribe/{{channel}}");

app.Run();

record WeatherForecast(DateOnly Date, int TemperatureC, string? Summary)
{
    public int TemperatureF => 32 + (int)(TemperatureC / 0.5556);
}
