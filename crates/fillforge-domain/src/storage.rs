use crate::{AppError, AppResult};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use ulid::Ulid;

pub fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::internal("The target has no parent directory."))?;
    fs::create_dir_all(parent)?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let temp = parent.join(format!(".{name}.{}.tmp", Ulid::new()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    drop(file);
    if let Err(error) = replace_file(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let mut bytes =
        serde_json::to_vec_pretty(value).map_err(|e| AppError::internal(e.to_string()))?;
    bytes.push(b'\n');
    atomic_write(path, &bytes)
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let bytes = fs::read(path)?;
    serde_json::from_slice(&bytes).map_err(|e| AppError::new("invalid_run_artifact", e.to_string()))
}

pub fn write_yaml<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let text = serde_yaml_ng::to_string(value).map_err(|e| AppError::internal(e.to_string()))?;
    atomic_write(path, text.as_bytes())
}

pub fn read_yaml<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let text = fs::read_to_string(path)
        .map_err(|e| AppError::new("invalid_template_schema", e.to_string()))?;
    serde_yaml_ng::from_str(&text)
        .map_err(|e| AppError::new("invalid_template_schema", e.to_string()))
}

pub fn list_subdirectories(path: &Path) -> AppResult<Vec<PathBuf>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let mut entries = fs::read_dir(path)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|kind| kind.is_dir())
                .map(|_| entry.path())
        })
        .collect::<Vec<_>>();
    entries.sort();
    Ok(entries)
}

pub fn copy_collision_avoiding(
    source: &Path,
    destination_dir: &Path,
    filename: &str,
) -> AppResult<PathBuf> {
    fs::create_dir_all(destination_dir)?;
    let filename = Path::new(filename)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = Path::new(&filename)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{s}"))
        .unwrap_or_default();
    let stem = filename.strip_suffix(&ext).unwrap_or(&filename);
    let mut candidate = filename.clone();
    let mut count = 2;
    while destination_dir.join(&candidate).exists() {
        candidate = format!("{stem}-{count}{ext}");
        count += 1;
    }
    let target = destination_dir.join(candidate);
    fs::copy(source, &target)?;
    Ok(target)
}
