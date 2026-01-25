use tracing_subscriber::{fmt, EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

pub fn init_tracing() {
    // Legge la variabile d'ambiente RUST_LOG o usa "info" come default
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    
    let fmt_layer = fmt::layer().with_target(false);

    // SubscriberExt fornisce .with(), SubscriberInitExt fornisce .init()
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .init();
}