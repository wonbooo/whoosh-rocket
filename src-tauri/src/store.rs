use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS kv (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
";

pub struct Store {
  connection: Connection,
}

impl Store {
  pub fn open(path: &Path) -> Result<Self, String> {
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let connection = Connection::open(path).map_err(|err| err.to_string())?;
    connection
      .execute_batch(SCHEMA)
      .map_err(|err| err.to_string())?;
    Ok(Self { connection })
  }

  pub fn get(&self, namespace: &str, key: &str) -> Result<Option<String>, String> {
    let mut statement = self
      .connection
      .prepare("SELECT value FROM kv WHERE namespace = ?1 AND key = ?2")
      .map_err(|err| err.to_string())?;
    let mut rows = statement
      .query(params![namespace, key])
      .map_err(|err| err.to_string())?;
    match rows.next().map_err(|err| err.to_string())? {
      Some(row) => Ok(Some(row.get(0).map_err(|err| err.to_string())?)),
      None => Ok(None),
    }
  }

  pub fn put(&self, namespace: &str, key: &str, value: &str) -> Result<(), String> {
    self
      .connection
      .execute(
        "INSERT INTO kv (namespace, key, value) VALUES (?1, ?2, ?3)
         ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value",
        params![namespace, key, value],
      )
      .map(|_| ())
      .map_err(|err| err.to_string())
  }

  pub fn delete(&self, namespace: &str, key: &str) -> Result<(), String> {
    self
      .connection
      .execute(
        "DELETE FROM kv WHERE namespace = ?1 AND key = ?2",
        params![namespace, key],
      )
      .map(|_| ())
      .map_err(|err| err.to_string())
  }

  pub fn namespace_entries(&self, namespace: &str) -> Result<Vec<(String, String)>, String> {
    let mut statement = self
      .connection
      .prepare("SELECT key, value FROM kv WHERE namespace = ?1 ORDER BY key")
      .map_err(|err| err.to_string())?;
    let rows = statement
      .query_map(params![namespace], |row| {
        Ok((row.get(0)?, row.get(1)?))
      })
      .map_err(|err| err.to_string())?;
    rows
      .collect::<Result<Vec<_>, _>>()
      .map_err(|err| err.to_string())
  }
}

pub fn database_path(app_data_dir: &Path) -> PathBuf {
  app_data_dir.join("whoosh.db")
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&database_path(dir.path())).unwrap();
    (dir, store)
  }

  #[test]
  fn round_trips_a_value() {
    let (_dir, store) = temp_store();
    assert_eq!(store.get("kingdee", "session").unwrap(), None);
    store.put("kingdee", "session", "{\"a\":1}").unwrap();
    assert_eq!(
      store.get("kingdee", "session").unwrap().as_deref(),
      Some("{\"a\":1}")
    );
  }

  #[test]
  fn overwrites_on_second_put() {
    let (_dir, store) = temp_store();
    store.put("auth", "token", "first").unwrap();
    store.put("auth", "token", "second").unwrap();
    assert_eq!(store.get("auth", "token").unwrap().as_deref(), Some("second"));
  }

  #[test]
  fn keeps_namespaces_separate_and_deletes() {
    let (_dir, store) = temp_store();
    store.put("auth", "token", "a").unwrap();
    store.put("analysis", "token", "b").unwrap();
    store.delete("auth", "token").unwrap();
    assert_eq!(store.get("auth", "token").unwrap(), None);
    assert_eq!(store.get("analysis", "token").unwrap().as_deref(), Some("b"));
  }

  #[test]
  fn lists_a_namespace_in_key_order() {
    let (_dir, store) = temp_store();
    store.put("analysis", "datasets", "[]").unwrap();
    store.put("analysis", "dashboards", "[]").unwrap();
    store.put("kingdee", "settings", "{}").unwrap();
    assert_eq!(
      store.namespace_entries("analysis").unwrap(),
      vec![
        ("dashboards".to_string(), "[]".to_string()),
        ("datasets".to_string(), "[]".to_string()),
      ]
    );
  }

  #[test]
  fn creates_the_parent_directory() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested").join("whoosh.db");
    Store::open(&path).unwrap();
    assert!(path.is_file());
  }
}
