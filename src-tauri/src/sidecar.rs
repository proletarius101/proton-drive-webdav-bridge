use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_opener::OpenerExt;

// GIO prelude brings methods like `mounts`, `root`, `uri`, etc. into scope
use gio::prelude::*; 

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
) -> Result<u32, String> {
    let mut lock = state.pid.lock().unwrap();
    if lock.is_some() {
        return Err("Sidecar already running".into());
    }

    let mut args = vec!["start".to_string()];
    if let Some(p) = port {
        args.push("--port".to_string());
        args.push(p.to_string());
    }

    let sidecar_cmd = app
        .shell()
        .sidecar("proton-drive-webdav-bridge")
        .map_err(|e| e.to_string())?
        .args(&args);

    let (mut rx, child) = sidecar_cmd.spawn().map_err(|e| e.to_string())?;
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
) -> Result<(), String> {
    let output = app
        .shell()
        .sidecar("proton-drive-webdav-bridge")
        .map_err(|e| e.to_string())?
        .args(["stop"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let mut lock = state.pid.lock().unwrap();
        *lock = None;
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn get_status(
    app: AppHandle,
    state: State<'_, SidecarState>,
) -> Result<StatusResponse, String> {
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
                port: 12345,
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

    for (uri, can_unmount) in mounts {
        // Normalize mount URI too
        let normalized_uri = if uri.ends_with('/') {
            uri
        } else {
            format!("{}/", uri)
        };

        if normalized_uri == normalized_target {
            return Some(can_unmount);
        }
    }
    None
}

#[tauri::command]
pub async fn login(app: AppHandle, email: String) -> Result<(), String> {
    let output = app
        .shell()
        .sidecar("proton-drive-webdav-bridge")
        .map_err(|e| e.to_string())?
        .args(["auth", "--email", &email])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn logout(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), String> {
    // Stop sidecar first if running
    let _ = stop_sidecar(app.clone(), state).await;

    let output = app
        .shell()
        .sidecar("proton-drive-webdav-bridge")
        .map_err(|e| e.to_string())?
        .args(["auth", "--logout"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn set_network_port(
    app: AppHandle,
    state: State<'_, SidecarState>,
    port: u16,
) -> Result<(), String> {
    // Restart sidecar with new port
    let _ = stop_sidecar(app.clone(), state.clone()).await;
    start_sidecar(app, state, Some(port)).await?;
    Ok(())
}

#[tauri::command]
pub async fn purge_cache(app: AppHandle) -> Result<(), String> {
    let output = app
        .shell()
        .sidecar("proton-drive-webdav-bridge")
        .map_err(|e| e.to_string())?
        .args(["config", "--purge-cache"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
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
fn open_uri_with<FPath, FUrl>(uri: &str, mut open_path: FPath, mut open_url: FUrl) -> Result<(), String>
where
    FPath: FnMut(&str) -> Result<(), String>,
    FUrl: FnMut(&str) -> Result<(), String>,
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
) -> Result<(), String> {
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
        |p: &str| opener.open_path(p, None::<&str>).map_err(|e| e.to_string()),
        |u: &str| opener.open_url(u, None::<&str>).map_err(|e| e.to_string()),
    )?;

    Ok(())
}

#[tauri::command]
pub async fn mount_drive(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), String> {
    let status = get_status(app.clone(), state).await.unwrap_or_else(|_| default_status_response());

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

                // Placeholder: Notify UI asynchronously (to be implemented)
                // Example: app.emit("mount-status", "Mounting in progress...").unwrap();

                inner_rx.try_recv().unwrap_or_else(|_| Err("Mount timed out".into()))
            });

            let final_result = result.unwrap_or_else(|e| Err(format!("Context error: {}", e)));
            let _ = tx.send(final_result);
        });

        match rx.recv_timeout(Duration::from_secs(20)) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(format!("Failed to mount: {}", e)),
            Err(_) => Err("Mount operation timed out".into()),
        }
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&uri)
            .spawn()
            .map_err(|e| e.to_string())?;
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
pub async fn unmount_drive(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), String> {
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
            Some(false) => return Err("Mount cannot be unmounted via GIO".into()),
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
                            .map_err(|e| format!("Failed to execute gio command: {}", e))?;

                        if !output.status.success() {
                            return Err(format!("Failed to unmount: {}", String::from_utf8_lossy(&output.stderr)));
                        }

                        return Ok(());
                    }
                }
            }
            None => return Err("Mount not found".into()),
        }
        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    {
        Err("Platform not supported".into())
    }
}

// Dev helper: emit a test sidecar log event. Only compiled in debug builds.
#[cfg(debug_assertions)]
#[tauri::command]
pub async fn emit_test_log(app: AppHandle, level: Option<String>, message: Option<String>) -> Result<(), String> {
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
pub async fn check_mount_status(app: AppHandle, state: State<'_, SidecarState>) -> Result<Option<String>, String> {
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
            app.emit("mount-status", format!("Checking mount: {}", uri.clone())).unwrap();

            if normalized_uri == normalized_target {
                let name = m.name();
                return Ok(Some(name.to_string()));
            }
        }

        // Emit final result to the UI
        app.emit("mount-status", "No matching mount found").unwrap();
        Ok(None)
    }

    #[cfg(not(target_os = "linux"))]
    {
        Ok(None)
    }
}


// Unit tests for mount matching logic
#[cfg(test)]
mod tests {
    use super::*;

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
            Err("should not be called".into())
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
            Err("should not be called".into())
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
}
