use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct AppPaths {
    pub home: PathBuf,
    pub config_dir: PathBuf,
    pub config_file: PathBuf,
    pub data_dir: PathBuf,
    pub templates_dir: PathBuf,
    pub runs_dir: PathBuf,
    pub exports_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub logs_dir: PathBuf,
}

pub fn resolve_app_paths(home: &Path) -> AppPaths {
    let config_dir = home.join(".config").join("fillforge");
    let data_dir = home.join(".local").join("fillforge");
    AppPaths {
        home: home.to_path_buf(),
        config_file: config_dir.join("config.yaml"),
        config_dir,
        templates_dir: data_dir.join("templates"),
        runs_dir: data_dir.join("runs"),
        exports_dir: data_dir.join("exports"),
        cache_dir: data_dir.join("cache"),
        logs_dir: data_dir.join("logs"),
        data_dir,
    }
}

pub fn app_paths() -> AppPaths {
    let home = std::env::var_os("FILLFORGE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));
    resolve_app_paths(&home)
}

pub fn is_path_inside(root: &Path, candidate: &Path) -> bool {
    candidate.starts_with(root)
}

pub fn ensure_app_directories(paths: &AppPaths) -> std::io::Result<()> {
    for path in [
        &paths.config_dir,
        &paths.data_dir,
        &paths.templates_dir,
        &paths.runs_dir,
        &paths.exports_dir,
        &paths.cache_dir,
        &paths.logs_dir,
    ] {
        std::fs::create_dir_all(path)?;
    }
    Ok(())
}
