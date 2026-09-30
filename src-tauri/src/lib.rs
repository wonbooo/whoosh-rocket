use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .setup(|app| {
      let path = store::database_path(&app.path().app_data_dir().map_err(|err| err.to_string())?);
      app.manage(Db(Mutex::new(store::Store::open(&path)?)));
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
      db_get,
      db_put,
      db_delete,
      db_list,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

mod license;
mod license_keys;
mod store;

use tauri::Manager;

struct Db(Mutex<store::Store>);

fn with_db<T>(
  app: &tauri::AppHandle,
  body: impl FnOnce(&store::Store) -> Result<T, String>,
) -> Result<T, String> {
  let state = app.state::<Db>();
  let guard = state.0.lock().map_err(|err| err.to_string())?;
  body(&guard)
}

#[tauri::command]
fn db_get(app: tauri::AppHandle, namespace: String, key: String) -> Result<Option<String>, String> {
  with_db(&app, |store| store.get(&namespace, &key))
}

#[tauri::command]
fn db_put(
  app: tauri::AppHandle,
  namespace: String,
  key: String,
  value: String,
) -> Result<(), String> {
  with_db(&app, |store| store.put(&namespace, &key, &value))
}

#[tauri::command]
fn db_delete(app: tauri::AppHandle, namespace: String, key: String) -> Result<(), String> {
  with_db(&app, |store| store.delete(&namespace, &key))
}

#[tauri::command]
fn db_list(app: tauri::AppHandle, namespace: String) -> Result<Vec<(String, String)>, String> {
  with_db(&app, |store| store.namespace_entries(&namespace))
}

fn app_license_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  Ok(dir.join("license.lic"))
}

fn current_license(app: &tauri::AppHandle) -> Result<Option<String>, String> {
  let stored = with_db(app, |store| {
    store.get(license::LICENSE_NAMESPACE, license::LICENSE_KEY)
  })?;
  if stored.is_some() {
    return Ok(stored);
  }
  let path = app_license_path(app)?;
  let legacy = std::fs::read_to_string(&path).ok();
  if let Some(text) = legacy.as_deref() {
    with_db(app, |store| {
      store.put(license::LICENSE_NAMESPACE, license::LICENSE_KEY, text.trim())
    })?;
    std::fs::remove_file(&path).ok();
  }
  Ok(legacy)
}

#[tauri::command]
fn get_machine_id() -> Result<String, String> {
  license::machine_id().map_err(|err| err.to_string())
}

#[tauri::command]
fn get_license_status(app: tauri::AppHandle) -> Result<license::LicenseStatus, String> {
  let machine_id = license::machine_id().map_err(|err| err.to_string())?;
  let text = current_license(&app)?;
  let key = license::verifying_key().map_err(|err| err.to_string())?;
  Ok(license::status_from_text(
    text.as_deref(),
    &machine_id,
    license::today(),
    &key,
  ))
}

#[tauri::command]
fn import_license(app: tauri::AppHandle, content: String) -> Result<license::LicenseStatus, String> {
  let machine_id = license::machine_id().map_err(|err| err.to_string())?;
  license::validate_license(&content, &machine_id, license::today())
    .map_err(|err| err.to_string())?;
  let text = content.trim().to_string();
  with_db(&app, |store| {
    store.put(license::LICENSE_NAMESPACE, license::LICENSE_KEY, &text)
  })?;
  let key = license::verifying_key().map_err(|err| err.to_string())?;
  Ok(license::status_from_text(
    Some(&text),
    &machine_id,
    license::today(),
    &key,
  ))
}

#[tauri::command]
fn issue_license(password: String, machine_id: String) -> Result<String, String> {
  license::issue_license_text(&password, &machine_id, license::today())
    .map_err(|err| err.to_string())
}
