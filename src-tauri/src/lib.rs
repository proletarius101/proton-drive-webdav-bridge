mod sidecar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  use crate::sidecar::{
    SidecarState, start_sidecar, stop_sidecar, get_status,
    set_network_port, purge_cache, open_in_files,
    mount_drive, unmount_drive, logout
  };

  tauri::Builder::default()
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
    .manage(SidecarState::new())
    .invoke_handler(tauri::generate_handler![
      start_sidecar,
      stop_sidecar,
      get_status,
      set_network_port,
      purge_cache,
      open_in_files,
      mount_drive,
      unmount_drive,
      logout,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
