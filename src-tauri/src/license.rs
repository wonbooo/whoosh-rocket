use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::{Local, Months, NaiveDate};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::license_keys::{ENCRYPTED_SEED_B64, PBKDF2_ITERS, PUBLIC_KEY_B64};

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const SEED_LEN: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LicenseError {
  Missing,
  Expired,
  MachineMismatch,
  Invalid,
  BadPassword,
  EmptyMachineId,
  Io(String),
}

impl LicenseError {
  pub fn user_message(&self) -> &'static str {
    match self {
      Self::Missing => "请先导入授权",
      Self::Expired => "授权已过期，请重新签发",
      Self::MachineMismatch => "授权与本机机器码不匹配",
      Self::Invalid => "授权文件无效",
      Self::BadPassword => "签发口令不正确",
      Self::EmptyMachineId => "请填写机器码",
      Self::Io(_) => "授权文件读写失败",
    }
  }
}

impl std::fmt::Display for LicenseError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(self.user_message())
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseDocument {
  pub v: u32,
  #[serde(rename = "machineId")]
  pub machine_id: String,
  #[serde(rename = "issuedAt")]
  pub issued_at: String,
  #[serde(rename = "expiresAt")]
  pub expires_at: String,
  pub sig: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
  pub valid: bool,
  pub machine_id: String,
  pub expires_at: Option<String>,
  pub reason: String,
}

pub fn add_calendar_months(date: NaiveDate, months: u32) -> NaiveDate {
  date
    .checked_add_months(Months::new(months))
    .unwrap_or(date)
}

pub fn canonical_payload(machine_id: &str, issued_at: &str, expires_at: &str) -> String {
  format!("1|{machine_id}|{issued_at}|{expires_at}")
}

pub fn unseal_seed(password: &str, blob: &[u8]) -> Result<[u8; SEED_LEN], LicenseError> {
  if blob.len() != SALT_LEN + NONCE_LEN + SEED_LEN + TAG_LEN {
    return Err(LicenseError::Invalid);
  }
  let salt = &blob[..SALT_LEN];
  let nonce = Nonce::from_slice(&blob[SALT_LEN..SALT_LEN + NONCE_LEN]);
  let sealed = &blob[SALT_LEN + NONCE_LEN..];
  let mut key_bytes = [0u8; 32];
  pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERS, &mut key_bytes);
  let cipher = Aes256Gcm::new_from_slice(&key_bytes).map_err(|_| LicenseError::Invalid)?;
  let plain = cipher
    .decrypt(nonce, sealed)
    .map_err(|_| LicenseError::BadPassword)?;
  let seed: [u8; SEED_LEN] = plain.try_into().map_err(|_| LicenseError::Invalid)?;
  Ok(seed)
}

pub fn verifying_key() -> Result<VerifyingKey, LicenseError> {
  let bytes = STANDARD
    .decode(PUBLIC_KEY_B64)
    .map_err(|_| LicenseError::Invalid)?;
  let raw: [u8; 32] = bytes.try_into().map_err(|_| LicenseError::Invalid)?;
  VerifyingKey::from_bytes(&raw).map_err(|_| LicenseError::Invalid)
}

fn signing_key_from_password(password: &str) -> Result<SigningKey, LicenseError> {
  let blob = STANDARD
    .decode(ENCRYPTED_SEED_B64)
    .map_err(|_| LicenseError::Invalid)?;
  let seed = unseal_seed(password, &blob)?;
  Ok(SigningKey::from_bytes(&seed))
}

pub fn sign_document(
  signing_key: &SigningKey,
  machine_id: &str,
  issued_at: NaiveDate,
  expires_at: NaiveDate,
) -> Result<String, LicenseError> {
  let issued = issued_at.format("%Y-%m-%d").to_string();
  let expires = expires_at.format("%Y-%m-%d").to_string();
  let payload = canonical_payload(machine_id, &issued, &expires);
  let sig = signing_key.sign(payload.as_bytes());
  let doc = LicenseDocument {
    v: 1,
    machine_id: machine_id.to_string(),
    issued_at: issued,
    expires_at: expires,
    sig: STANDARD.encode(sig.to_bytes()),
  };
  serde_json::to_string(&doc).map_err(|_| LicenseError::Invalid)
}

pub fn issue_license_text(
  password: &str,
  machine_id: &str,
  today: NaiveDate,
) -> Result<String, LicenseError> {
  let machine_id = machine_id.trim();
  if machine_id.is_empty() {
    return Err(LicenseError::EmptyMachineId);
  }
  let key = signing_key_from_password(password)?;
  let expires = add_calendar_months(today, 3);
  sign_document(&key, machine_id, today, expires)
}

pub fn parse_license(text: &str) -> Result<LicenseDocument, LicenseError> {
  serde_json::from_str(text.trim()).map_err(|_| LicenseError::Invalid)
}

pub fn verify_document(
  doc: &LicenseDocument,
  verifying_key: &VerifyingKey,
) -> Result<(), LicenseError> {
  if doc.v != 1 {
    return Err(LicenseError::Invalid);
  }
  let sig_bytes = STANDARD
    .decode(doc.sig.trim())
    .map_err(|_| LicenseError::Invalid)?;
  let sig = Signature::from_slice(&sig_bytes).map_err(|_| LicenseError::Invalid)?;
  let payload = canonical_payload(&doc.machine_id, &doc.issued_at, &doc.expires_at);
  verifying_key
    .verify(payload.as_bytes(), &sig)
    .map_err(|_| LicenseError::Invalid)
}

pub fn validate_license_with_key(
  text: &str,
  machine_id: &str,
  today: NaiveDate,
  verifying_key: &VerifyingKey,
) -> Result<LicenseDocument, LicenseError> {
  let doc = parse_license(text)?;
  verify_document(&doc, verifying_key)?;
  if doc.machine_id != machine_id {
    return Err(LicenseError::MachineMismatch);
  }
  let expires = NaiveDate::parse_from_str(&doc.expires_at, "%Y-%m-%d")
    .map_err(|_| LicenseError::Invalid)?;
  if today > expires {
    return Err(LicenseError::Expired);
  }
  Ok(doc)
}

pub fn validate_license(
  text: &str,
  machine_id: &str,
  today: NaiveDate,
) -> Result<LicenseDocument, LicenseError> {
  let key = verifying_key()?;
  validate_license_with_key(text, machine_id, today, &key)
}

pub fn machine_id() -> Result<String, LicenseError> {
  read_machine_id().map_err(|err| LicenseError::Io(err))
}

#[cfg(windows)]
fn read_machine_id() -> Result<String, String> {
  use winreg::enums::HKEY_LOCAL_MACHINE;
  use winreg::RegKey;
  let key = RegKey::predef(HKEY_LOCAL_MACHINE)
    .open_subkey(r"SOFTWARE\Microsoft\Cryptography")
    .map_err(|err| err.to_string())?;
  key
    .get_value::<String, _>("MachineGuid")
    .map_err(|err| err.to_string())
}

#[cfg(not(windows))]
fn read_machine_id() -> Result<String, String> {
  hostname::get()
    .map_err(|err| err.to_string())?
    .into_string()
    .map_err(|_| "hostname is not utf-8".to_string())
}

pub fn today() -> NaiveDate {
  Local::now().date_naive()
}

pub fn license_file_path(app_data_dir: &Path) -> PathBuf {
  app_data_dir.join("license.lic")
}

pub fn read_license_file(path: &Path) -> Result<String, LicenseError> {
  std::fs::read_to_string(path).map_err(|_| LicenseError::Missing)
}

pub fn write_license_file(path: &Path, text: &str) -> Result<(), LicenseError> {
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent).map_err(|err| LicenseError::Io(err.to_string()))?;
  }
  std::fs::write(path, text).map_err(|err| LicenseError::Io(err.to_string()))
}

pub fn status_from_file(path: &Path, machine_id: &str, today: NaiveDate) -> LicenseStatus {
  match read_license_file(path) {
    Err(LicenseError::Missing) => LicenseStatus {
      valid: false,
      machine_id: machine_id.to_string(),
      expires_at: None,
      reason: LicenseError::Missing.user_message().to_string(),
    },
    Err(err) => LicenseStatus {
      valid: false,
      machine_id: machine_id.to_string(),
      expires_at: None,
      reason: err.user_message().to_string(),
    },
    Ok(text) => match validate_license(&text, machine_id, today) {
      Ok(doc) => LicenseStatus {
        valid: true,
        machine_id: machine_id.to_string(),
        expires_at: Some(doc.expires_at),
        reason: String::new(),
      },
      Err(err) => LicenseStatus {
        valid: false,
        machine_id: machine_id.to_string(),
        expires_at: None,
        reason: err.user_message().to_string(),
      },
    },
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn test_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
  }

  fn test_verify_key() -> VerifyingKey {
    test_key().verifying_key()
  }

  #[test]
  fn adds_three_calendar_months() {
    let start = NaiveDate::from_ymd_opt(2026, 9, 5).unwrap();
    assert_eq!(
      add_calendar_months(start, 3),
      NaiveDate::from_ymd_opt(2026, 12, 5).unwrap()
    );
  }

  #[test]
  fn clamps_month_add_to_end_of_month() {
    let start = NaiveDate::from_ymd_opt(2026, 11, 30).unwrap();
    assert_eq!(
      add_calendar_months(start, 3),
      NaiveDate::from_ymd_opt(2027, 2, 28).unwrap()
    );
  }

  #[test]
  fn signed_license_verifies_on_same_machine_before_expiry() {
    let issued = NaiveDate::from_ymd_opt(2026, 9, 5).unwrap();
    let expires = add_calendar_months(issued, 3);
    let text = sign_document(&test_key(), "machine-a", issued, expires).unwrap();
    let doc = parse_license(&text).unwrap();
    verify_document(&doc, &test_verify_key()).unwrap();
    assert_eq!(doc.expires_at, "2026-12-05");
    assert_eq!(doc.machine_id, "machine-a");
  }

  #[test]
  fn rejects_wrong_machine() {
    let issued = NaiveDate::from_ymd_opt(2026, 9, 5).unwrap();
    let text = sign_document(
      &test_key(),
      "machine-a",
      issued,
      add_calendar_months(issued, 3),
    )
    .unwrap();
    let err = validate_license_with_key(
      &text,
      "machine-b",
      issued,
      &test_verify_key(),
    )
    .unwrap_err();
    assert_eq!(err, LicenseError::MachineMismatch);
  }

  #[test]
  fn rejects_expired_license() {
    let issued = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    let text = sign_document(
      &test_key(),
      "machine-a",
      issued,
      add_calendar_months(issued, 3),
    )
    .unwrap();
    let err = validate_license_with_key(
      &text,
      "machine-a",
      NaiveDate::from_ymd_opt(2026, 5, 1).unwrap(),
      &test_verify_key(),
    )
    .unwrap_err();
    assert_eq!(err, LicenseError::Expired);
  }

  #[test]
  fn issue_rejects_empty_machine_id() {
    let err = issue_license_text(
      "x",
      "  ",
      NaiveDate::from_ymd_opt(2026, 9, 5).unwrap(),
    )
    .unwrap_err();
    assert_eq!(err, LicenseError::EmptyMachineId);
  }

  #[test]
  fn issue_rejects_wrong_password() {
    let err = issue_license_text(
      "not-the-issuer-password",
      "machine-a",
      NaiveDate::from_ymd_opt(2026, 9, 5).unwrap(),
    )
    .unwrap_err();
    assert_eq!(err, LicenseError::BadPassword);
  }

  #[test]
  fn tampered_payload_fails_verify() {
    let issued = NaiveDate::from_ymd_opt(2026, 9, 5).unwrap();
    let mut doc = parse_license(
      &sign_document(
        &test_key(),
        "machine-a",
        issued,
        add_calendar_months(issued, 3),
      )
      .unwrap(),
    )
    .unwrap();
    doc.machine_id = "machine-b".into();
    assert!(verify_document(&doc, &test_verify_key()).is_err());
  }

  #[test]
  fn wrong_password_cannot_unseal_production_blob() {
    let blob = STANDARD.decode(ENCRYPTED_SEED_B64).unwrap();
    let err = unseal_seed("not-the-issuer-password", &blob).unwrap_err();
    assert_eq!(err, LicenseError::BadPassword);
  }

  #[test]
  fn missing_file_status_asks_to_import() {
    let status = status_from_file(
      Path::new("this-license-file-does-not-exist.lic"),
      "machine-a",
      NaiveDate::from_ymd_opt(2026, 9, 5).unwrap(),
    );
    assert!(!status.valid);
    assert_eq!(status.reason, "请先导入授权");
  }
}
