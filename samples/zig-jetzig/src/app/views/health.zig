const jetzig = @import("jetzig");

pub fn index(request: *jetzig.Request) !jetzig.View {
    var root = try request.data(.object);
    try root.put("status", "OK");
    return request.render(.ok);
}
