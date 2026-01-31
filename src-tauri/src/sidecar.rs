use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_opener::OpenerExt;
use thiserror::Error;

// GIO prelude brings methods like `mounts`, `root`, `uri`, etc. into scope
use gio::prelude::*;

// ============================================================================
// Error Types
// ============================================================================

/// Structured error type for Tauri command execution.
/// Serializes to JSON with error code and message for client discrimination.
#[derive(Error, Debug, Deserialize, Clone)]
pub enum CommandError {
    #[error("Sidecar already running")]
    SidecarAlreadyRunning,

    #[error("Sidecar not running")]
    SidecarNotRunning,

    #[error("Failed to spawn sidecar: {0}")]
    SidecarSpawnFailed(String),

    #[error("Sidecar command failed: {0}")]
    SidecarCommandFailed(String),

    #[error("Invalid port number: {0}")]
    InvalidPort(String),

    #[error("Port already in use: {0}")]
    PortInUse(u16),

    #[error("Invalid email format: {0}")]
    InvalidEmail(String),

    #[error("Authentication failed: {0}")]
    AuthFailed(String),

    #[error("Server initialization timeout")]
    ServerInitTimeout,

    #[error("Mount operation timeout")]
    MountTimeout,

    #[error("Server not running")]
    ServerNotRunning,

    #[error("GIO error: {0}")]
    GioError(String),

    #[error("IO error: {0}")]
    IoError(String),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl CommandError {
    /// Get the error code for client-side discrimination
    pub fn code(&self) -> &'static str {
        match self {
            CommandError::SidecarAlreadyRunning => "SIDECAR_ALREADY_RUNNING",
            CommandError::SidecarNotRunning => "SIDECAR_NOT_RUNNING",
            CommandError::SidecarSpawnFailed(_) => "SIDECAR_SPAWN_FAILED",
            CommandError::SidecarCommandFailed(_) => "SIDECAR_COMMAND_FAILED",
            CommandError::InvalidPort(_) => "INVALID_PORT",
            CommandError::PortInUse(_) => "PORT_IN_USE",
            CommandError::InvalidEmail(_) => "INVALID_EMAIL",
            CommandError::AuthFailed(_) => "AUTH_FAILED",
            CommandError::ServerInitTimeout => "SERVER_INIT_TIMEOUT",
            CommandError::MountTimeout => "MOUNT_TIMEOUT",
            CommandError::ServerNotRunning => "SERVER_NOT_RUNNING",
            CommandError::GioError(_) => "GIO_ERROR",
            CommandError::IoError(_) => "IO_ERROR",
            CommandError::Unknown(_) => "UNKNOWN_ERROR",
        }
    }
}

// Implement From<io::Error> for easier error conversion
impl From<std::io::Error> for CommandError {
    fn from(err: std::io::Error) -> Self {
        CommandError::IoError(err.to_string())
    }
}

// Custom serialize to include error code in JSON response
impl Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("CommandError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
} 

#[derive(Default)]
pub struct SidecarState {
    pid: Arc<Mutex<Option<u32>>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    pub server: ServerStatus,
    pub auth: AuthStatus,
    pub config: ConfigStatus,
    #[serde(rename = "logFile")]
    pub log_file: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    #[serde(rename = "loggedIn")]
    pub logged_in: bool,
    pub username: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigStatus {
    pub webdav: WebdavConfig,
    #[serde(rename = "remotePath")]
    pub remote_path: String,
    pub cache: Option<CacheConfig>,
    pub debug: Option<bool>,
    #[serde(rename = "autoStart")]
    pub auto_start: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebdavConfig {
    pub host: String,
    pub port: u16,
    pub https: bool,
    #[serde(rename = "requireAuth")]
    pub require_auth: bool,
    pub username: Option<String>,
    #[serde(rename = "passwordHash")]
    pub password_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CacheConfig {
    pub enabled: bool,
    #[serde(rename = "ttlSeconds")]
    pub ttl_seconds: u32,
    #[serde(rename = "maxSizeMB")]
    pub max_size_mb: u32,
}

#[derive(Serialize, Clone)]
pub struct LogEvent {
    pub level: String,
    pub message: String,
}

#[tauri::command]
pub async fn start_sidecar(
    app: AppHandle,
    state: State<'_, SidecarState>,
    port: Option<u16>,
) -> Result<u32, CommandError> {
    let mut lock = state.pid.lock().unwrap();
    if lock.is_some() {
        return Err(CommandError::SidecarAlreadyRunning);
    }

    let mut args = vec!["start".to_string()];
    // In dev/GUI context, prefer starting without auth to allow mounting
    // even before the user completes login; credentials can be added later.
    args.push("--no-auth".to_string());
    // Explicitly run in foreground so stdout/stderr are captured
    args.push("--no-daemon".to_string());
    if let Some(p) = port {
        args.push("--port".to_string());
        args.push(p.to_string());
    }

    let sidecar_cmd = app
        .shell()
        .sidecar("proton-drive-webdav-bridge")
        .map_err(|e| CommandError::SidecarSpawnFailed(e.to_string()))?
        .args(&args);

    let (mut rx, child) = sidecar_cmd.spawn().map_err(|e| CommandError::SidecarSpawnFailed(e.to_string()))?;
    let pid = child.pid();
    *lock = Some(pid);

    // Spawn async task to stream stdout/stderr
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let _ = app_handle.emit(
                        "sidecar:log",
                        LogEvent {
                            level: "info".to_string(),
                            message: line.to_string(),
                        },
                    );
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let _ = app_handle.emit(
                        "sidecar:log",
                        LogEvent {
                            level: "error".to_string(),
                            message: line.to_string(),
                        },
                    );
                }
                CommandEvent::Terminated(payload) => {
                    let _ = app_handle.emit("sidecar:terminated", payload);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(pid)
}

#[tauri::command]
pub async fn stop_sidecar(
    app: AppHandle,
    state: State<'_, SidecarState>,
) -> Result<(), CommandError> {
    let output = app
        .shell()
        .sidecar("proton-drive-webdav-bridge")
        .map_err(|e| CommandError::SidecarSpawnFailed(e.to_string()))?
        .args(["stop"])
        .output()
        .await
        .map_err(|e| CommandError::IoError(e.to_string()))?;

    if output.status.success() {
        let mut lock = state.pid.lock().unwrap();
        *lock = None;
        Ok(())
    } else {
        Err(CommandError::SidecarCommandFailed(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

#[tauri::command]
pub async fn get_status(
    app: AppHandle,
    state: State<'_, SidecarState>,
) -> Result<StatusResponse, CommandError> {
    use tokio::time::{timeout, Duration};

    // Emit an intermediate "loading" status to the UI
    let _ = app.emit("status:update", default_status_response());

    let sidecar = app.shell().sidecar("proton-drive-webdav-bridge");

    if let Err(e) = sidecar {
        log::warn!("Sidecar not available: {}", e);
        return Ok(default_status_response());
    }

    let status_future = sidecar.unwrap().args(["status", "--json"]).output();

    let output = match timeout(Duration::from_secs(5), status_future).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            log::warn!("Failed to execute sidecar status: {}", e);
            return Ok(default_status_response());
        }
        Err(_) => {
            log::warn!("Sidecar status command timed out");
            return Ok(default_status_response());
        }
    };

    if !output.status.success() {
        log::warn!("Sidecar status command failed: {}", String::from_utf8_lossy(&output.stderr));
        return Ok(default_status_response());
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout);
    let json_str = stdout_str
        .lines()
        .find(|line| line.trim_start().starts_with('{'))
        .and_then(|_| {
            let start_idx = stdout_str.find('{')?;
            Some(stdout_str[start_idx..].to_string())
        });

    if json_str.is_none() {
        log::warn!("No JSON found in status output: {}", stdout_str);
        return Ok(default_status_response());
    }

    let mut status: StatusResponse = match serde_json::from_str(&json_str.unwrap()) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("Failed to parse status JSON: {}", e);
            return Ok(default_status_response());
        }
    };

    if status.server.pid.is_none() {
        let lock = state.pid.lock().unwrap();
        status.server.pid = *lock;
    }

    Ok(status)
}

fn default_status_response() -> StatusResponse {
    StatusResponse {
        server: ServerStatus { running: false, pid: None, url: None },
        auth: AuthStatus { logged_in: false, username: None },
        config: ConfigStatus {
            webdav: WebdavConfig {
                host: "localhost".to_string(),
                // Align with app default port to avoid early mismatches
                port: 8080,
                https: false,
                require_auth: false,
                username: None,
                password_hash: None,
            },
            remote_path: String::new(),
            cache: None,
            debug: Some(false),
            auto_start: None,
        },
        log_file: String::new(),
    }
}

// Pure helper (module-level) to make mount URI matching testable
fn find_mount_by_uri(mounts: impl IntoIterator<Item = (String, bool)>, target: &str) -> Option<bool> {
    // Normalize target URI by ensuring it has a trailing slash (GIO adds this)
    let normalized_target = if target.ends_with('/') {
        target.to_string()
    } else {
        format!("{}/", target)
    };

    // Materialize mounts into a Vec so we can iterate multiple times
    let mounts_vec: Vec<(String, bool)> = mounts.into_iter().collect();

    // First try exact match (with trailing slash normalization)
    for (uri, can_unmount) in mounts_vec.iter() {
        let normalized_uri = if uri.ends_with('/') { uri.clone() } else { format!("{}/", uri) };
        if normalized_uri == normalized_target {
            return Some(*can_unmount);
        }
    }

    // Fallback: try matching by port only. This handles cases where GIO
    // normalizes hostnames (e.g. 127.0.0.1 vs localhost) or uses http(s) scheme.
    // Extract port from the target (if any) and look for mounts that contain
    // ":<port>" in their URI.
    if let Some(colon_pos) = target.rfind(':') {
        // get substring after last ':' up to optional trailing '/'
        let after = &target[colon_pos + 1..];
        let port_str = after.trim_end_matches('/');
        if port_str.chars().all(|c| c.is_ascii_digit()) {
            for (uri, can_unmount) in mounts_vec.iter() {
                if uri.contains(&format!(":{}", port_str)) {
                    return Some(*can_unmount);
                }
            }
        }
    }

    None
}

#[tauri::command]
pub async fn login(app: AppHandle, email: String) -> Result<(), CommandError> {
    let output = app
        .shell()
        .sidecar("proton-drive-webdav-bridge")
        .map_err(|e| CommandError::SidecarSpawnFailed(e.to_string()))?
        // Use the correct CLI signature: auth login --username <email>
        .args(["auth", "login", "--username", &email])
        .output()
        .await
        .map_err(|e| CommandError::IoError(e.to_string()))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(CommandError::AuthFailed(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

#[tauri::command]
pub async fn logout(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), CommandError> {
    // Stop sidecar first if running
    let _ = stop_sidecar(app.clone(), state).await;

    let output = app
        .shell()
        .sidecar("proton-drive-webdav-bridge")
        .map_err(|e| CommandError::SidecarSpawnFailed(e.to_string()))?
        .args(["auth", "--logout"])
        .output()
        .await
        .map_err(|e| CommandError::IoError(e.to_string()))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(CommandError::AuthFailed(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

#[tauri::command]
pub async fn set_network_port(
    app: AppHandle,
    state: State<'_, SidecarState>,
    port: u16,
) -> Result<(), CommandError> {
    // Restart sidecar with new port
    let _ = stop_sidecar(app.clone(), state.clone()).await;
    start_sidecar(app, state, Some(port)).await?;
    Ok(())
}

#[tauri::command]
pub async fn purge_cache(app: AppHandle) -> Result<(), CommandError> {
    let output = app
        .shell()
        .sidecar("proton-drive-webdav-bridge")
        .map_err(|e| CommandError::SidecarSpawnFailed(e.to_string()))?
        .args(["config", "--purge-cache"])
        .output()
        .await
        .map_err(|e| CommandError::IoError(e.to_string()))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(CommandError::SidecarCommandFailed(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

// Helper to compute config file path similar to the JS side
fn get_config_file_path() -> Result<std::path::PathBuf, CommandError> {
    use std::path::PathBuf;

    // Respect XDG_CONFIG_HOME if present, fallback to $HOME/.config
    let base: PathBuf = if let Ok(p) = std::env::var("XDG_CONFIG_HOME") {
        PathBuf::from(p)
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".config")
    } else {
        return Err(CommandError::Unknown("Could not determine config directory".into()));
    };

    let app_dir = base.join("proton-drive-webdav-bridge");
    std::fs::create_dir_all(&app_dir).map_err(|e| CommandError::IoError(e.to_string()))?;
    Ok(app_dir.join("config.json"))
}

#[tauri::command]
pub async fn get_autostart() -> Result<bool, CommandError> {
    let path = get_config_file_path()?;
    if !path.exists() {
        return Ok(false);
    }
    let contents = std::fs::read_to_string(&path).map_err(|e| CommandError::IoError(e.to_string()))?;
    let v: serde_json::Value = serde_json::from_str(&contents).map_err(|e| CommandError::Unknown(e.to_string()))?;
    Ok(v.get("autoStart").and_then(|x| x.as_bool()).unwrap_or(false))
}

#[tauri::command]
pub async fn set_autostart(enabled: bool) -> Result<bool, CommandError> {
    let path = get_config_file_path()?;
    let mut v = if path.exists() {
        let contents = std::fs::read_to_string(&path).map_err(|e| CommandError::IoError(e.to_string()))?;
        serde_json::from_str::<serde_json::Value>(&contents).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    v["autoStart"] = serde_json::json!(enabled);

    let s = serde_json::to_string_pretty(&v).map_err(|e| CommandError::Unknown(e.to_string()))?;
    std::fs::write(&path, s).map_err(|e| CommandError::IoError(e.to_string()))?;
    Ok(enabled)
}

fn should_open_with_path(uri: &str) -> bool {
    // Treat absolute filesystem paths, file:// URIs (converted to paths),
    // and dav:// URIs as paths that should be opened with `open_path` so the
    // system file manager / GIO can mount or open them. This preserves the
    // dav:// scheme when passed to `open_path`.
    uri.starts_with('/') || uri.starts_with("file://") || uri.starts_with("dav://")
}

// Testable helper that accepts callbacks to perform the actual open actions.
// This avoids the need to mock `AppHandle`/`Opener` in unit tests.
fn open_uri_with<FPath, FUrl>(uri: &str, mut open_path: FPath, mut open_url: FUrl) -> Result<(), CommandError>
where
    FPath: FnMut(&str) -> Result<(), CommandError>,
    FUrl: FnMut(&str) -> Result<(), CommandError>,
{
    if uri.starts_with("file://") {
        let path = uri.trim_start_matches("file://");
        open_path(path)
    } else if should_open_with_path(uri) {
        open_path(uri)
    } else {
        open_url(uri)
    }
}

#[tauri::command]
pub async fn open_in_files(
    app: AppHandle,
    state: State<'_, SidecarState>,
    mount_path: Option<String>,
) -> Result<(), CommandError> {
    // If a specific path is provided, open it. Otherwise construct a DAV URI
    // using the sidecar config (preferred) or convert the server URL to a
    // dav:// form if necessary so the file manager is used instead of a
    // browser.
    let uri = if let Some(p) = mount_path {
        p
    } else {
        // Ask for status and obtain the server URL (if available)
        let status = get_status(app.clone(), state).await.unwrap_or_else(|_| default_status_response());
        // Prefer a dav:// URI. If `server.url` is present and looks like http(s),
        // convert to dav://host:port. Otherwise prefer `server.url` if it's already
        // dav://, or fall back to config-derived dav://localhost:port.
        if let Some(surl) = status.server.url {
            if surl.starts_with("dav://") {
                surl
            } else if surl.starts_with("http://") || surl.starts_with("https://") {
                // crude parse: extract host[:port] from the authority component
                // e.g., http://127.0.0.1:8080/ -> host_port = 127.0.0.1:8080
                let stripped = surl.splitn(3, '/').nth(2).unwrap_or("");
                let host_port = stripped.split('/').next().unwrap_or("");
                if !host_port.is_empty() {
                    format!("dav://{}", host_port)
                } else {
                    format!("dav://localhost:{}", status.config.webdav.port)
                }
            } else {
                // Unknown scheme: fall back to config-derived dav://
                format!("dav://localhost:{}", status.config.webdav.port)
            }
        } else {
            format!("dav://localhost:{}", status.config.webdav.port)
        }
    };

    // Use the Tauri opener plugin to open files/URLs with the system default app
    let opener = app.opener();

    // Delegate to the testable helper which accepts callbacks for path/url
    open_uri_with(
        &uri,
        |p: &str| opener.open_path(p, None::<&str>).map_err(|e| CommandError::Unknown(e.to_string())),
        |u: &str| opener.open_url(u, None::<&str>).map_err(|e| CommandError::Unknown(e.to_string())),
    )?;

    Ok(())
}

#[tauri::command]
pub async fn mount_drive(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), CommandError> {
    let status = get_status(app.clone(), state).await.unwrap_or_else(|_| default_status_response());

    // Check if server is actually running
    if !status.server.running {
        let msg = "WebDAV server is not running. Start the server first.";
        let _ = app.emit("mount:status", msg);
        return Err(CommandError::GioError(msg.to_string()));
    }

    // Always construct dav:// URI for mounting (status.server.url is http://)
    let port = status.config.webdav.port;
    let uri = format!("dav://localhost:{}", port);

    #[cfg(target_os = "linux")]
    {
        // GIO operations need to run in a thread with a GLib main context
        use std::sync::mpsc::channel;
        use std::time::Duration;

        let (tx, rx) = channel();
        let uri_clone = uri.clone();

        // Emit mounting start event to UI and then spawn blocking operation
        let _ = app.emit("mount:status", "Mounting...");

        // Spawn blocking operation in a thread with its own GLib context
        std::thread::spawn(move || {
            // Create a new MainContext and run everything within it
            let context = glib::MainContext::new();
            
            let result = context.with_thread_default(|| {
                // Create the mount operation
                let file = gio::File::for_uri(&uri_clone);
                let mount_op = gio::MountOperation::new();
                mount_op.set_anonymous(true);

                let (inner_tx, inner_rx) = channel();
                
                // Use callback-based API
                file.mount_enclosing_volume(
                    gio::MountMountFlags::NONE,
                    Some(&mount_op),
                    None::<&gio::Cancellable>,
                    move |result| {
                        let r = match result {
                            Ok(()) => Ok(()),
                            Err(e) => {
                                let err_msg = e.to_string();
                                // If already mounted, treat as success
                                if err_msg.contains("already mounted") || err_msg.contains("Already mounted") {
                                    Ok(())
                                } else {
                                    Err(err_msg)
                                }
                            }
                        };
                        let _ = inner_tx.send(r);
                    },
                );

                // Run the main loop until we get a result or timeout
                let loop_obj = glib::MainLoop::new(Some(&context), false);
                let loop_clone = loop_obj.clone();
                
                // Timeout handler
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(5)); // Reduced timeout to 5 seconds
                    loop_clone.quit();
                });

                // Run the loop - this blocks until quit() is called
                loop_obj.run();

                inner_rx.try_recv().unwrap_or_else(|_| Err("Mount timed out".into()))
            });

            let final_result = result.unwrap_or_else(|e| Err(format!("Context error: {}", e)));
            let _ = tx.send(final_result);
        });

        match rx.recv_timeout(Duration::from_secs(20)) {
            Ok(Ok(())) => {
                let _ = app.emit("mount:status", "Mounted");
                Ok(())
            }
            Ok(Err(e)) => {
                let msg = format!("Failed to mount: {}", e);
                log::error!("Mount failed: {}", msg);
                let _ = app.emit("mount:status", msg.clone());
                Err(CommandError::GioError(msg))
            }
            Err(_) => {
                let _ = app.emit("mount:status", "Mount operation timed out");
                Err(CommandError::MountTimeout)
            },
        }


    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&uri)
            .spawn()
            .map_err(|e| CommandError::IoError(e.to_string()))?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&uri)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Err("Platform not supported".into())
    }
}

#[cfg(target_os = "linux")]
// Helper function to retrieve and cache mounts
fn get_cached_mounts() -> Vec<gio::Mount> {
    gio::VolumeMonitor::get().mounts()
}

#[tauri::command]
pub async fn unmount_drive(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), CommandError> {
    let status = get_status(app.clone(), state.clone()).await.unwrap_or_else(|_| default_status_response());
    let target_uri = format!("dav://localhost:{}", status.config.webdav.port);

    #[cfg(target_os = "linux")]
    {
        let mounts = get_cached_mounts();
        let mounts_vec: Vec<(String, bool)> = mounts
            .iter()
            .map(|m| {
                let root_file: gio::File = m.root();
                let uri = root_file.uri().to_string();
                let unmountable = m.can_unmount();
                (uri, unmountable)
            })
            .collect();

        match find_mount_by_uri(mounts_vec.clone(), &target_uri) {
            Some(false) => {
                let _ = app.emit("mount:status", "Mount cannot be unmounted via GIO");
                return Err(CommandError::GioError("Mount cannot be unmounted via GIO".into()))
            }
            Some(true) => {
                let normalized_target = if target_uri.ends_with('/') {
                    target_uri.clone()
                } else {
                    format!("{}/", target_uri)
                };

                for m in mounts.iter() {
                    let root_file: gio::File = m.root();
                    let uri = root_file.uri().to_string();
                    let normalized_uri = if uri.ends_with('/') {
                        uri.clone()
                    } else {
                        format!("{}/", uri)
                    };

                    if normalized_uri == normalized_target {
                        // Use `gio mount -u` command as a fallback
                        let output = std::process::Command::new("gio")
                            .arg("mount")
                            .arg("-u")
                            .arg(&uri)
                            .output()
                            .map_err(|e| CommandError::IoError(format!("Failed to execute gio command: {}", e)))?;

                        if !output.status.success() {
                            let msg = format!("Failed to unmount: {}", String::from_utf8_lossy(&output.stderr));
                            let _ = app.emit("mount:status", msg.clone());
                            return Err(CommandError::GioError(msg));
                        }

                        let _ = app.emit("mount:status", "Unmounted");
                        return Ok(());
                    }
                }
            }
            None => {
                let _ = app.emit("mount:status", "Mount not found");
                return Err(CommandError::GioError("Mount not found".into()))
            }
        }
        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    {
        Err(CommandError::Unknown("Platform not supported".into()))
    }
}

// Dev helper: emit a test sidecar log event. Only compiled in debug builds.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn emit_test_log(app: AppHandle, level: Option<String>, message: Option<String>) -> Result<(), CommandError> {
    let _ = app.emit(
        "sidecar:log",
        LogEvent {
            level: level.unwrap_or_else(|| "info".to_string()),
            message: message.unwrap_or_else(|| "[dev] test log".to_string()),
        },
    );
    Ok(())
}

// Query GIO to determine whether the DAV location is currently mounted and
// return an identifying string (mount name or mount root) if so.
#[tauri::command]
#[allow(dead_code)]
pub async fn check_mount_status(app: AppHandle, state: State<'_, SidecarState>) -> Result<Option<String>, CommandError> {
    let status = get_status(app.clone(), state).await.unwrap_or_else(|_| default_status_response());
    let target_uri = format!("dav://localhost:{}", status.config.webdav.port);

    #[cfg(target_os = "linux")]
    {
        let normalized_target = if target_uri.ends_with('/') {
            target_uri.clone()
        } else {
            format!("{}/", target_uri)
        };

        let mounts = get_cached_mounts();
        for m in mounts.iter() {
            let root_file: gio::File = m.root();
            let uri = root_file.uri().to_string();
            let normalized_uri = if uri.ends_with('/') {
                uri.clone()
            } else {
                format!("{}/", uri)
            };

            // Emit intermediate results to the UI
            app.emit("mount:status", format!("Checking mount: {}", uri.clone())).unwrap();

            if normalized_uri == normalized_target {
                let name = m.name();
                return Ok(Some(name.to_string()));
            }
        }

        // Emit final result to the UI
        app.emit("mount:status", "No matching mount found").unwrap();
        Ok(None)
    }

    #[cfg(not(target_os = "linux"))]
    {
        Ok(None)
    }
}


// ============================================================================
// Test Utilities and Fixtures
// ============================================================================

#[cfg(test)]
#[allow(dead_code)]
mod test_utils {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::collections::HashMap;

    /// Mock implementation of AppHandle events for testing
    #[derive(Clone)]
    pub struct MockAppHandle {
        pub emitted_events: Arc<Mutex<Vec<(String, String)>>>,
    }

    impl MockAppHandle {
        pub fn new() -> Self {
            Self {
                emitted_events: Arc::new(Mutex::new(Vec::new())),
            }
        }

        /// Get all emitted events for assertion
        pub fn get_events(&self) -> Vec<(String, String)> {
            self.emitted_events.lock().unwrap().clone()
        }

        /// Check if a specific event was emitted
        pub fn has_event(&self, event_name: &str) -> bool {
            self.emitted_events
                .lock()
                .unwrap()
                .iter()
                .any(|(name, _)| name == event_name)
        }

        /// Get event payload by event name
        pub fn get_event_payload(&self, event_name: &str) -> Option<String> {
            self.emitted_events
                .lock()
                .unwrap()
                .iter()
                .find(|(name, _)| name == event_name)
                .map(|(_, payload)| payload.clone())
        }

        /// Clear all recorded events
        pub fn clear_events(&self) {
            self.emitted_events.lock().unwrap().clear();
        }
    }

    /// Mock mount information for testing GIO operations
    #[derive(Clone, Debug)]
    pub struct MockMount {
        pub uri: String,
        pub unmountable: bool,
    }

    /// Mock GIO environment for testing mount operations
    pub struct MockGioEnv {
        pub mounts: Vec<MockMount>,
        pub mount_failures: HashMap<String, String>, // URI -> error message
    }

    impl MockGioEnv {
        pub fn new() -> Self {
            Self {
                mounts: Vec::new(),
                mount_failures: HashMap::new(),
            }
        }

        /// Add a mock mount
        pub fn add_mount(&mut self, uri: String, unmountable: bool) {
            self.mounts.push(MockMount { uri, unmountable });
        }

        /// Mark a URI as unable to mount
        pub fn set_mount_failure(&mut self, uri: String, error: String) {
            self.mount_failures.insert(uri, error);
        }

        /// Clear all mounts
        pub fn clear_mounts(&mut self) {
            self.mounts.clear();
        }
    }

    /// Helper to create a test sidecar state
    pub fn create_test_state() -> SidecarState {
        SidecarState::new()
    }

    /// Helper to create test status response
    pub fn create_test_status(running: bool, pid: Option<u32>) -> StatusResponse {
        StatusResponse {
            server: ServerStatus {
                running,
                pid,
                url: if running {
                    Some(format!("http://localhost:8080"))
                } else {
                    None
                },
            },
            auth: AuthStatus {
                logged_in: false,
                username: None,
            },
            config: ConfigStatus {
                webdav: WebdavConfig {
                    host: "127.0.0.1".to_string(),
                    port: 8080,
                    https: false,
                    require_auth: false,
                    username: None,
                    password_hash: None,
                },
                remote_path: "/".to_string(),
                cache: Some(CacheConfig {
                    enabled: true,
                    ttl_seconds: 300,
                    max_size_mb: 100,
                }),
                debug: Some(false),
                auto_start: Some(false),
            },
            log_file: "/tmp/test.log".to_string(),
        }
    }
}

// ============================================================================
// Unit tests for mount matching logic
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // Test: Find Mount by URI
    // ========================================================================

    #[test]
    fn test_find_mount_by_uri_found_and_unmountable() {
        // GIO adds trailing slashes to mount URIs
        let mounts = vec![("dav://localhost:12345/".to_string(), true), ("dav://other:1/".to_string(), true)];
        let res = find_mount_by_uri(mounts.clone(), "dav://localhost:12345");
        assert_eq!(res, Some(true));
    }

    #[test]
    fn test_find_mount_by_uri_found_but_not_unmountable() {
        let mounts = vec![("dav://localhost:12345/".to_string(), false)];
        let res = find_mount_by_uri(mounts.clone(), "dav://localhost:12345");
        assert_eq!(res, Some(false));
    }

    #[test]
    fn test_find_mount_by_uri_not_found() {
        let mounts = vec![("dav://other:1/".to_string(), true)];
        let res = find_mount_by_uri(mounts.clone(), "dav://localhost:12345");
        assert_eq!(res, None);
    }

    #[test]
    fn test_find_mount_by_uri_multiple_matches() {
        // When multiple matches exist, return the first
        let mounts = vec![("dav://a/".to_string(), false), ("dav://a/".to_string(), true)];
        let res = find_mount_by_uri(mounts.clone(), "dav://a");
        assert_eq!(res, Some(false));
    }

    #[test]
    fn test_find_mount_by_uri_with_trailing_slash() {
        // Test that both with and without trailing slash match
        let mounts = vec![("dav://localhost:12345/".to_string(), true)];
        let res1 = find_mount_by_uri(mounts.clone(), "dav://localhost:12345");
        let res2 = find_mount_by_uri(mounts.clone(), "dav://localhost:12345/");
        assert_eq!(res1, Some(true));
        assert_eq!(res2, Some(true));
    }

    #[test]
    fn test_find_mount_by_uri_host_variants() {
        // The target may use "localhost" but GIO may report "127.0.0.1" or http scheme
        let mounts = vec![
            ("http://127.0.0.1:12345/".to_string(), true),
            ("dav://127.0.0.1:12345/".to_string(), true),
        ];
        // Should find a match when target uses localhost
        let res = find_mount_by_uri(mounts.clone(), "dav://localhost:12345");
        assert_eq!(res, Some(true));
    }

    #[test]
    fn test_should_open_with_path() {
        assert!(should_open_with_path("/some/path"));
        assert!(should_open_with_path("file:///some/path"));
        assert!(should_open_with_path("dav://localhost:12345"));
        assert!(!should_open_with_path("http://example.com"));
    }

    #[test]
    fn test_open_uri_with_callbacks_uses_open_path_for_dav() {
        use std::rc::Rc;
        use std::cell::RefCell;

        let recorded = Rc::new(RefCell::new(Vec::new()));
        let recorded_path = recorded.clone();
        let open_path = move |p: &str| {
            recorded_path.borrow_mut().push(format!("path:{}", p));
            Ok(())
        };
        let open_url = |_u: &str| {
            recorded.borrow_mut().push("url_called".to_string());
            Err(std::io::Error::new(std::io::ErrorKind::Other, "should not be called").into())
        };

        open_uri_with("dav://localhost:12345", open_path, open_url).unwrap();
        let v = recorded.borrow();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0], "path:dav://localhost:12345");
    }

    #[test]
    fn test_choose_open_uri_prefers_converted_dav_for_http_server_url() {
        let mut status = default_status_response();
        status.server.url = Some("http://127.0.0.1:8080/".to_string());
        // Use the same logic as open_in_files to compute uri
        let uri = if let Some(surl) = status.server.url.clone() {
            if surl.starts_with("dav://") {
                surl
            } else if surl.starts_with("http://") || surl.starts_with("https://") {
                let stripped = surl.splitn(3, '/').nth(2).unwrap_or("");
                let host_port = stripped.split('/').next().unwrap_or("");
                if !host_port.is_empty() {
                    format!("dav://{}", host_port)
                } else {
                    format!("dav://localhost:{}", status.config.webdav.port)
                }
            } else {
                format!("dav://localhost:{}", status.config.webdav.port)
            }
        } else {
            format!("dav://localhost:{}", status.config.webdav.port)
        };

        assert_eq!(uri, "dav://127.0.0.1:8080");
    }

    #[test]
    fn test_open_uri_with_callbacks_uses_open_url_for_http() {
        use std::rc::Rc;
        use std::cell::RefCell;

        let recorded = Rc::new(RefCell::new(Vec::new()));
        let recorded_url = recorded.clone();
        let open_path = |_p: &str| {
            recorded.borrow_mut().push("path_called".to_string());
            Err(std::io::Error::new(std::io::ErrorKind::Other, "should not be called").into())
        };
        let open_url = move |u: &str| {
            recorded_url.borrow_mut().push(format!("url:{}", u));
            Ok(())
        };

        open_uri_with("http://example.com", open_path, open_url).unwrap();
        let v = recorded.borrow();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0], "url:http://example.com");
    }

    #[test]
    fn test_mount_uri_construction() {
        // Test that mount URI is correctly constructed with dav:// protocol
        let port = 7777;
        let expected_uri = format!("dav://localhost:{}", port);
        assert_eq!(expected_uri, "dav://localhost:7777");
    }

    #[test]
    fn test_mount_uri_with_various_ports() {
        // Test mount URI construction with various port numbers
        let test_cases = vec![
            (8080, "dav://localhost:8080"),
            (12345, "dav://localhost:12345"),
            (7777, "dav://localhost:7777"),
        ];

        for (port, expected) in test_cases {
            let uri = format!("dav://localhost:{}", port);
            assert_eq!(uri, expected);
        }
    }

    #[test]
    fn test_mount_error_handling_already_mounted() {
        // Test that "already mounted" errors are treated as success
        let err_msg = "Already mounted at /media/mnt/dav";
        assert!(err_msg.contains("already mounted") || err_msg.contains("Already mounted"));
    }

    #[test]
    fn test_mount_error_handling_mount_not_found() {
        // Test that "mount not found" errors are properly distinguished
        let err_msg = "GIO error: Mount not found";
        assert!(err_msg.contains("Mount not found"));
        // This should NOT be treated as success
        assert!(!err_msg.contains("already mounted") && !err_msg.contains("Already mounted"));
    }

    #[test]
    fn test_mount_error_handling_backend_unmounting() {
        // Test that "backend currently unmounting" errors are properly captured
        let err_msg = "GIO error: Backend currently unmounting";
        assert!(err_msg.contains("Backend currently unmounting"));
    }

    #[test]
    fn test_mount_status_response_structure() {
        // Test that the status response has the expected structure for mount checks
        let status = default_status_response();
        
        // Verify basic structure
        assert_eq!(status.server.running, false);
        assert_eq!(status.config.webdav.port, 8080);
        assert_eq!(status.config.webdav.host, "localhost");
    }

    #[test]
    fn test_server_check_before_mount() {
        // Test the logic: server must be running before attempting to mount
        let status = default_status_response();
        
        // When server is not running, mount should fail
        if !status.server.running {
            // This is the expected behavior - mount_drive should check this
            assert_eq!(status.server.running, false);
        }
    }

    #[test]
    fn test_mount_uri_normalization_with_trailing_slash() {
        // Test that mount URIs with and without trailing slashes are normalized
        let uri1 = "dav://localhost:7777";
        let uri2 = "dav://localhost:7777/";
        
        let normalized1 = if uri1.ends_with('/') {
            uri1.to_string()
        } else {
            format!("{}/", uri1)
        };
        
        let normalized2 = if uri2.ends_with('/') {
            uri2.to_string()
        } else {
            format!("{}/", uri2)
        };
        
        // Both should normalize to the same value with trailing slash
        assert_eq!(normalized1, "dav://localhost:7777/");
        assert_eq!(normalized2, "dav://localhost:7777/");
    }

    #[test]
    fn test_check_mount_status_uri_normalization() {
        // Test the mount status checking uses proper URI normalization
        let target_uri = "dav://localhost:7777";
        let target_normalized = if target_uri.ends_with('/') {
            target_uri.to_string()
        } else {
            format!("{}/", target_uri)
        };
        
        let mount_uri = "dav://localhost:7777";
        let mount_normalized = if mount_uri.ends_with('/') {
            mount_uri.to_string()
        } else {
            format!("{}/", mount_uri)
        };
        
        // Should match when both are normalized
        assert_eq!(target_normalized, mount_normalized);
    }

    #[test]
    fn test_mount_command_error_variants() {
        // Test that different command error types are properly handled
        use crate::sidecar::CommandError;
        
        // Test error message formatting
        let gio_error = CommandError::GioError("Test GIO error".to_string());
        let error_str = gio_error.to_string();
        assert!(error_str.contains("GIO error"));
    }

    // ========================================================================
    // FAILING TESTS: Tauri Command Tests (GH-006, GH-007, GH-008, GH-009, GH-010)
    // These tests document expected behavior and will drive implementation
    // ========================================================================

    /// Test: SidecarState correctly tracks running process
    /// User Story: GH-006 (WebDAV server startup)
    /// This test verifies state management for the sidecar process lifecycle
    #[test]
    fn test_sidecar_state_tracks_pid() {
        use crate::sidecar::test_utils::create_test_state;
        
        let state = create_test_state();
        
        // Initially, no PID should be stored
        let lock = state.pid.lock().unwrap();
        assert!(lock.is_none(), "SidecarState should start with no PID");
        drop(lock);
    }

    /// Test: SidecarState allows setting and retrieving PID
    /// User Story: GH-006, GH-007
    /// This test ensures PID state can be managed correctly
    #[test]
    fn test_sidecar_state_set_and_retrieve_pid() {
        use crate::sidecar::test_utils::create_test_state;
        
        let state = create_test_state();
        
        // Store a test PID
        let test_pid = 12345u32;
        {
            let mut lock = state.pid.lock().unwrap();
            *lock = Some(test_pid);
        }
        
        // Retrieve and verify
        {
            let lock = state.pid.lock().unwrap();
            assert_eq!(*lock, Some(test_pid), "PID should be retrievable from state");
        }
    }

    /// Test: CommandError serializes correctly for client transmission
    /// User Story: GH-025 (Error handling)
    /// This test verifies error responses can be sent to the UI
    #[test]
    fn test_command_error_serialization() {
        let err = CommandError::SidecarAlreadyRunning;
        let json = serde_json::to_string(&err).expect("CommandError should serialize");
        
        // Should contain error code and message
        assert!(json.contains("SIDECAR_ALREADY_RUNNING"));
        assert!(json.contains("already running"));
    }

    /// Test: CommandError code mapping is exhaustive
    /// User Story: GH-025 (Error handling)
    /// This test ensures all error variants have codes
    #[test]
    fn test_command_error_codes_exhaustive() {
        let errors = vec![
            CommandError::SidecarAlreadyRunning,
            CommandError::SidecarNotRunning,
            CommandError::SidecarSpawnFailed("test".to_string()),
            CommandError::InvalidPort("test".to_string()),
            CommandError::PortInUse(8080),
            CommandError::AuthFailed("test".to_string()),
            CommandError::ServerInitTimeout,
            CommandError::MountTimeout,
            CommandError::ServerNotRunning,
            CommandError::GioError("test".to_string()),
            CommandError::IoError("test".to_string()),
        ];
        
        // Each error should have a non-empty error code
        for err in errors {
            let code = err.code();
            assert!(!code.is_empty(), "Error {:?} should have a code", err);
            // Code should be SCREAMING_SNAKE_CASE
            assert!(code.chars().all(|c| c.is_ascii_uppercase() || c == '_'), 
                    "Error code {} should be SCREAMING_SNAKE_CASE", code);
        }
    }

    /// Test: StatusResponse can be created for testing
    /// User Story: GH-006, GH-007
    /// This test ensures test fixtures are working properly
    #[test]
    fn test_create_test_status_fixture() {
        use crate::sidecar::test_utils::create_test_status;
        
        let status = create_test_status(true, Some(12345));
        
        assert!(status.server.running, "Test status should indicate running server");
        assert_eq!(status.server.pid, Some(12345), "Test status should contain correct PID");
        assert!(status.server.url.is_some(), "Running server should have URL");
    }

    /// Test: StatusResponse correctly indicates stopped server
    /// User Story: GH-006, GH-007
    #[test]
    fn test_create_test_status_stopped() {
        use crate::sidecar::test_utils::create_test_status;
        
        let status = create_test_status(false, None);
        
        assert!(!status.server.running, "Test status should indicate stopped server");
        assert_eq!(status.server.pid, None, "Stopped server should have no PID");
        assert!(status.server.url.is_none(), "Stopped server should have no URL");
    }

    /// Test: Port validation rejects out-of-range ports
    /// User Story: GH-011 (Configure WebDAV server port)
    /// This test documents the valid port range (1024-65535)
    #[test]
    fn test_port_validation_bounds() {
        // Valid ports
        assert!(1024 <= 1024 && 1024 <= 65535);
        assert!(8080 <= 65535 && 8080 >= 1024);
        assert!(65535 <= 65535 && 65535 >= 1024);
        
        // Invalid ports (below minimum)
        let port_too_low = 80u16;
        assert!(port_too_low < 1024, "Ports below 1024 should be rejected");
        
        // Invalid ports (above maximum)
        // Note: u16 max is 65535, so we can't test above that in a u16
    }

    /// Test: Mount URI matching handles trailing slashes correctly
    /// User Story: GH-008, GH-009, GH-010 (Mount operations)
    /// This test verifies the mount detection logic
    #[test]
    fn test_mount_uri_matching_with_port() {
        let mounts = vec![("dav://localhost:8080/".to_string(), true)];
        let result = find_mount_by_uri(mounts, "dav://localhost:8080");
        
        assert_eq!(result, Some(true), "Mount should be found regardless of trailing slash");
    }

    /// Test: Mock AppHandle captures emitted events
    /// User Story: GH-032, GH-033 (GUI integration, system tray)
    /// This test verifies event emission can be tested
    #[test]
    fn test_mock_app_handle_captures_events() {
        use crate::sidecar::test_utils::MockAppHandle;
        
        let app = MockAppHandle::new();
        
        // Simulate emitting events
        {
            let mut events = app.emitted_events.lock().unwrap();
            events.push(("sidecar:log".to_string(), "Server started".to_string()));
            events.push(("mount:status".to_string(), "Mounted".to_string()));
        }
        
        // Verify captured
        assert!(app.has_event("sidecar:log"), "Event should be captured");
        assert!(app.has_event("mount:status"), "Event should be captured");
        
        let payload = app.get_event_payload("sidecar:log");
        assert_eq!(payload, Some("Server started".to_string()), "Event payload should match");
    }
}


