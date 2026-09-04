#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
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
    .invoke_handler(tauri::generate_handler![
      get_machine_id,
      get_license_status,
      import_license,
      issue_license,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

mod license;
mod license_keys;

use tauri::Manager;

fn app_license_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  Ok(license::license_file_path(&dir))
}

#[tauri::command]
fn get_machine_id() -> Result<String, String> {
  license::machine_id().map_err(|err| err.to_string())
}

#[tauri::command]
fn get_license_status(app: tauri::AppHandle) -> Result<license::LicenseStatus, String> {
  let machine_id = license::machine_id().map_err(|err| err.to_string())?;
  let path = app_license_path(&app)?;
  Ok(license::status_from_file(
    &path,
    &machine_id,
    license::today(),
  ))
}

#[tauri::command]
fn import_license(app: tauri::AppHandle, content: String) -> Result<license::LicenseStatus, String> {
  let machine_id = license::machine_id().map_err(|err| err.to_string())?;
  license::validate_license(&content, &machine_id, license::today())
    .map_err(|err| err.to_string())?;
  let path = app_license_path(&app)?;
  license::write_license_file(&path, content.trim())
    .map_err(|err| err.to_string())?;
  Ok(license::status_from_file(
    &path,
    &machine_id,
    license::today(),
  ))
}

#[tauri::command]
fn issue_license(password: String, machine_id: String) -> Result<String, String> {
  license::issue_license_text(&password, &machine_id, license::today())
    .map_err(|err| err.to_string())
}
