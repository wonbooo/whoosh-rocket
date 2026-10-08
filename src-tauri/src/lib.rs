use std::sync::Mutex;

use chrono::{Local, NaiveDate};

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
  require_license(&app)?;
  with_db(&app, |store| store.get(&namespace, &key))
}

#[tauri::command]
fn db_put(
  app: tauri::AppHandle,
  namespace: String,
  key: String,
  value: String,
) -> Result<(), String> {
  require_license(&app)?;
  with_db(&app, |store| store.put(&namespace, &key, &value))
}

#[tauri::command]
fn db_delete(app: tauri::AppHandle, namespace: String, key: String) -> Result<(), String> {
  require_license(&app)?;
  with_db(&app, |store| store.delete(&namespace, &key))
}

#[tauri::command]
fn db_list(app: tauri::AppHandle, namespace: String) -> Result<Vec<(String, String)>, String> {
  require_license(&app)?;
  with_db(&app, |store| store.namespace_entries(&namespace))
}

fn app_license_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  Ok(dir.join("license.lic"))
}

fn require_license(app: &tauri::AppHandle) -> Result<(), String> {
  let machine_id = license::machine_id().map_err(|err| err.to_string())?;
  let text = current_license(app)?.ok_or_else(|| license::LicenseError::Missing.to_string())?;
  license::validate_license(&text, &machine_id, trusted_today(app))
    .map(|_| ())
    .map_err(|err| err.to_string())
}

/// The date license checks use: a recently fetched NTP time when one is
/// available, otherwise the local clock. A fresh network time is cached so
/// later checks work offline; one past its trust window is refreshed.
fn trusted_today(app: &tauri::AppHandle) -> NaiveDate {
  let cached = cached_network_time(app);
  if cached.is_some_and(|(fetched_at, _)| network_time_is_fresh(fetched_at)) {
    return license::effective_today(cached);
  }
  if let Some(fetched_at) = license::fetch_network_time() {
    let fetched_on = fetched_at.date_naive();
    store_network_time(app, fetched_at, fetched_on);
    return license::effective_today(Some((fetched_at, fetched_on)));
  }
  // A reading that aged out still anchors the date. Falling back to the clock
  // here would let a changed system time win the moment the network is unreachable.
  if cached.is_some() {
    return license::effective_today(cached);
  }
  license::today()
}

const TIME_NAMESPACE: &str = "license";
const TIME_FETCHED_AT: &str = "networkTimeAt";
const TIME_FETCHED_ON: &str = "networkTimeDate";

/// A cached network time is reusable while the local clock says it was fetched
/// within the last six hours and not in the future.
fn network_time_is_fresh(fetched_at: chrono::DateTime<chrono::Utc>) -> bool {
  let age = Local::now().naive_utc() - fetched_at.naive_utc();
  age >= chrono::TimeDelta::zero() && age <= chrono::TimeDelta::seconds(6 * 60 * 60)
}

fn cached_network_time(
  app: &tauri::AppHandle,
) -> Option<(chrono::DateTime<chrono::Utc>, NaiveDate)> {
  let at = with_db(app, |store| store.get(TIME_NAMESPACE, TIME_FETCHED_AT)).ok()??;
  let on = with_db(app, |store| store.get(TIME_NAMESPACE, TIME_FETCHED_ON)).ok()??;
  let fetched_at = chrono::DateTime::parse_from_rfc3339(&at).ok()?.to_utc();
  let fetched_on = NaiveDate::parse_from_str(&on, "%Y-%m-%d").ok()?;
  Some((fetched_at, fetched_on))
}

fn store_network_time(
  app: &tauri::AppHandle,
  fetched_at: chrono::DateTime<chrono::Utc>,
  fetched_on: NaiveDate,
) {
  let at = fetched_at.to_rfc3339();
  let on = fetched_on.format("%Y-%m-%d").to_string();
  let _ = with_db(app, |store| store.put(TIME_NAMESPACE, TIME_FETCHED_AT, &at));
  let _ = with_db(app, |store| store.put(TIME_NAMESPACE, TIME_FETCHED_ON, &on));
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
    trusted_today(&app),
    &key,
  ))
}

#[tauri::command]
fn import_license(app: tauri::AppHandle, content: String) -> Result<license::LicenseStatus, String> {
  let machine_id = license::machine_id().map_err(|err| err.to_string())?;
  let today = trusted_today(&app);
  license::validate_license(&content, &machine_id, today)
    .map_err(|err| err.to_string())?;
  let text = content.trim().to_string();
  with_db(&app, |store| {
    store.put(license::LICENSE_NAMESPACE, license::LICENSE_KEY, &text)
  })?;
  let key = license::verifying_key().map_err(|err| err.to_string())?;
  Ok(license::status_from_text(
    Some(&text),
    &machine_id,
    today,
    &key,
  ))
}

#[tauri::command]
fn issue_license(password: String, machine_id: String) -> Result<String, String> {
  license::issue_license_text(&password, &machine_id, license::today())
    .map_err(|err| err.to_string())
}
