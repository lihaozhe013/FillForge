use chrono::Utc;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const MAX_LOG_SIZE: u64 = 2 * 1024 * 1024;

#[derive(Clone)]
pub struct AppLogger {
    base_dir: Arc<PathBuf>,
    guard: Arc<Mutex<()>>,
}

impl AppLogger {
    pub fn new(release_logs_dir: &Path) -> Self {
        let base_dir = if cfg!(debug_assertions) {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("debug-logs")
        } else {
            release_logs_dir.to_path_buf()
        };
        let _ = fs::create_dir_all(&base_dir);
        Self {
            base_dir: Arc::new(base_dir),
            guard: Arc::new(Mutex::new(())),
        }
    }

    pub fn base_dir(&self) -> &Path {
        self.base_dir.as_path()
    }

    pub fn event(&self, level: &str, message: &str) {
        self.append("debug.log", &format!("[{level}] {message}"));
    }

    pub fn feature(&self, feature: &str, message: &str) {
        let safe = feature
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect::<String>();
        self.append(
            &format!("debug-{}.log", if safe.is_empty() { "app" } else { &safe }),
            message,
        );
    }

    fn append(&self, filename: &str, message: &str) {
        let Ok(_lock) = self.guard.lock() else {
            return;
        };
        let target = self.base_dir.join(filename);
        if target
            .metadata()
            .map(|metadata| metadata.len() > MAX_LOG_SIZE)
            .unwrap_or(false)
        {
            let previous = previous_path(&target);
            let _ = fs::remove_file(&previous);
            let _ = fs::rename(&target, previous);
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(target) {
            let _ = writeln!(file, "{} {message}", Utc::now().to_rfc3339());
        }
    }
}

fn previous_path(path: &Path) -> PathBuf {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("debug");
    path.with_file_name(format!("{stem}.previous.log"))
}
