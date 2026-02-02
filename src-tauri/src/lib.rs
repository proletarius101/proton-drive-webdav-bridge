mod sidecar;

#[cfg(debug_assertions)]
use crate::sidecar::emit_test_log;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  use crate::sidecar::{
    SidecarState, start_sidecar, stop_sidecar, get_status, login,
    set_network_port, purge_cache, open_in_files,
    mount_drive, unmount_drive, check_mount_status, logout, get_autostart, set_autostart,
    list_accounts, get_account
  };

  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .manage(SidecarState::new());

  // Conditionally include dev-only commands in debug builds
  #[cfg(debug_assertions)]
  let builder = builder.invoke_handler(tauri::generate_handler![
      start_sidecar,
      stop_sidecar,
      get_status,
      login,
      set_network_port,
      purge_cache,
      open_in_files,
      mount_drive,
      unmount_drive,
      check_mount_status,
      logout,
      get_autostart,
      set_autostart,
      list_accounts,
      get_account,
      emit_test_log,
  ]);

  #[cfg(not(debug_assertions))]
  let builder = builder.invoke_handler(tauri::generate_handler![
      start_sidecar,
      stop_sidecar,
      get_status,
      login,
      set_network_port,
      purge_cache,
      open_in_files,
      mount_drive,
      unmount_drive,
      check_mount_status,
      logout,
      get_autostart,
      set_autostart,
      list_accounts,
      get_account,
  ]);

  builder
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
