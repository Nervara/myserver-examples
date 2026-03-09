use actix_web::{get, App, HttpResponse, HttpServer, Responder};
use std::env;

#[get("/health")]
async fn health() -> impl Responder {
    HttpResponse::Ok().body("OK")
}

#[get("/")]
async fn hello() -> impl Responder {
    HttpResponse::Ok().body("Hello from Actix on Railpack!")
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    HttpServer::new(|| {
        App::new()
            .service(health)
            .service(hello)
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}
