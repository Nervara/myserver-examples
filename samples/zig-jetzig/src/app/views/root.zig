const jetzig = @import("jetzig");

pub fn index(request: *jetzig.Request) !jetzig.View {
    var root = try request.data(.object);
    try root.put("message", "Hello from Jetzig on Railpack!");
    try root.put("framework", "jetzig");
    return request.render(.ok);
}
