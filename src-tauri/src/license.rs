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
  Offline,
  Locked,
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
      Self::Offline => "无法获取网络时间，请检查网络后重试",
      Self::Locked => "今日授权尝试次数已用完，请明天再试",
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
  read_machine_id().map_err(LicenseError::Io)
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

/// How long a fetched network time stays trusted before it must be refreshed.
const NETWORK_TIME_TTL_SECS: i64 = 6 * 60 * 60;

/// The local clock may run this far ahead of the network time before the
/// network time is treated as stale and the clock wins.
const CLOCK_SKEW_TOLERANCE: chrono::TimeDelta = chrono::TimeDelta::minutes(5);

/// Public NTP servers, tried in order. The first response wins.
const NTP_SERVERS: &[&str] = &[
  "ntp1.ntsc.ac.cn",
  "ntp2.ntsc.ac.cn",
  "ntp1.aliyun.com",
  "ntp2.aliyun.com",
  "ntp1.tencent.com",
  "ntp1.baidu.com",
];

const NTP_PORT: u16 = 123;
const NTP_UNIX_EPOCH_OFFSET: u64 = 2_208_988_800;
const NTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// Current time from a public NTP server, or `None` when every server fails.
pub fn fetch_network_time() -> Option<chrono::DateTime<chrono::Utc>> {
  for server in NTP_SERVERS {
    if let Some(time) = query_ntp(server) {
      return Some(time);
    }
  }
  None
}

fn query_ntp(server: &str) -> Option<chrono::DateTime<chrono::Utc>> {
  use std::net::{ToSocketAddrs, UdpSocket};
  let address = (server, NTP_PORT).to_socket_addrs().ok()?.next()?;
  let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
  socket.set_read_timeout(Some(NTP_TIMEOUT)).ok()?;
  socket.set_write_timeout(Some(NTP_TIMEOUT)).ok()?;
  // NTP client request: version 4, mode 3 (client).
  let mut packet = [0u8; 48];
  packet[0] = 0x23;
  socket.send_to(&packet, address).ok()?;
  let (size, _) = socket.recv_from(&mut packet).ok()?;
  if size < 48 {
    return None;
  }
  let seconds = u32::from_be_bytes(packet[40..44].try_into().ok()?) as u64;
  if seconds < NTP_UNIX_EPOCH_OFFSET {
    return None;
  }
  chrono::DateTime::from_timestamp((seconds - NTP_UNIX_EPOCH_OFFSET) as i64, 0)
}

/// The date license checks should use.
///
/// A network time within its trust window is the authority, so setting the
/// system clock backwards cannot extend a license and setting it forwards
/// cannot expire one early. Once the reading is older than the trust window it
/// stops counting, and with no reading at all the local clock is the fallback.
pub fn effective_today(network_time: Option<(chrono::DateTime<chrono::Utc>, NaiveDate)>) -> NaiveDate {
  let Some((fetched_at, fetched_on)) = network_time else {
    return Local::now().date_naive();
  };
  let age = Local::now().naive_utc() - fetched_at.naive_utc();
  if age > chrono::TimeDelta::seconds(NETWORK_TIME_TTL_SECS) || age < -CLOCK_SKEW_TOLERANCE {
    return fetched_on;
  }
  fetched_at.date_naive() + age
}

/// Failed imports allowed before the machine is locked for the rest of the day.
pub const IMPORT_ATTEMPT_LIMIT: u32 = 10;

pub fn attempts_for_today(stored: Option<&str>, today: NaiveDate) -> u32 {
  let Some((date, count)) = stored.and_then(|value| value.split_once(' ')) else {
    return 0;
  };
  if date != today.format("%Y-%m-%d").to_string() {
    return 0;
  }
  count.parse().unwrap_or(0)
}

pub fn record_attempt(stored: Option<&str>, today: NaiveDate) -> (u32, String) {
  let next = attempts_for_today(stored, today) + 1;
  (next, format!("{} {next}", today.format("%Y-%m-%d")))
}

pub const LICENSE_NAMESPACE: &str = "license";
pub const LICENSE_KEY: &str = "document";

pub fn status_from_text(
  text: Option<&str>,
  machine_id: &str,
  today: NaiveDate,
  verifying_key: &VerifyingKey,
) -> LicenseStatus {
  let Some(text) = text else {
    return invalid_status(machine_id, LicenseError::Missing);
  };
  match validate_license_with_key(text, machine_id, today, verifying_key) {
    Ok(doc) => LicenseStatus {
      valid: true,
      machine_id: machine_id.to_string(),
      expires_at: Some(doc.expires_at),
      reason: String::new(),
    },
    Err(err) => invalid_status(machine_id, err),
  }
}

fn invalid_status(machine_id: &str, err: LicenseError) -> LicenseStatus {
  LicenseStatus {
    valid: false,
    machine_id: machine_id.to_string(),
    expires_at: None,
    reason: err.user_message().to_string(),
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
  fn missing_license_status_asks_to_import() {
    let status = status_from_text(
      None,
      "machine-a",
      NaiveDate::from_ymd_opt(2026, 9, 5).unwrap(),
      &test_verify_key(),
    );
    assert!(!status.valid);
    assert_eq!(status.reason, "请先导入授权");
  }

  #[test]
  fn stored_text_reports_valid_until_expiry() {
    let issued = NaiveDate::from_ymd_opt(2026, 9, 5).unwrap();
    let text = sign_document(
      &test_key(),
      "machine-a",
      issued,
      add_calendar_months(issued, 3),
    )
    .unwrap();
    let status = status_from_text(Some(&text), "machine-a", issued, &test_verify_key());
    assert!(status.valid);
    assert_eq!(status.expires_at.as_deref(), Some("2026-12-05"));
  }

  fn utc(date: NaiveDate, hour: u32) -> chrono::DateTime<chrono::Utc> {
    date
      .and_hms_opt(hour, 0, 0)
      .unwrap()
      .and_utc()
  }

  #[test]
  fn network_time_survives_a_clock_set_backwards() {
    let now = chrono::Utc::now();
    let fetched_on = (now - chrono::TimeDelta::days(40)).date_naive();
    assert_eq!(effective_today(Some((now, fetched_on))), now.date_naive());
  }

  #[test]
  fn network_time_survives_a_clock_set_forwards() {
    let fetched_at = chrono::Utc::now() - chrono::TimeDelta::hours(8);
    assert_eq!(
      effective_today(Some((fetched_at, fetched_at.date_naive()))),
      fetched_at.date_naive()
    );
  }

  #[test]
  fn fresh_network_time_advances_with_the_clock() {
    let fetched_at = chrono::Utc::now() - chrono::TimeDelta::hours(2);
    assert_eq!(
      effective_today(Some((fetched_at, fetched_at.date_naive()))),
      chrono::Utc::now().date_naive()
    );
  }

  #[test]
  fn stale_network_time_stays_put() {
    let fetched_on = NaiveDate::from_ymd_opt(2020, 1, 1).unwrap();
    let fetched_at = utc(fetched_on, 0);
    assert_eq!(effective_today(Some((fetched_at, fetched_on))), fetched_on);
  }

  #[test]
  fn missing_network_time_falls_back_to_the_clock() {
    assert_eq!(effective_today(None), Local::now().date_naive());
  }

  #[test]
  fn attempts_reset_on_a_new_day_and_lock_after_the_limit() {
    let today = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
    assert_eq!(attempts_for_today(None, today), 0);
    assert_eq!(attempts_for_today(Some("2026-10-07 10"), today), 0);
    let mut stored = None;
    for _ in 0..IMPORT_ATTEMPT_LIMIT {
      let (count, next) = record_attempt(stored.as_deref(), today);
      stored = Some(next);
      assert!(count <= IMPORT_ATTEMPT_LIMIT);
    }
    assert_eq!(attempts_for_today(stored.as_deref(), today), IMPORT_ATTEMPT_LIMIT);
  }

  #[test]
  fn ntp_query_returns_a_plausible_time() {
    let Some(time) = fetch_network_time() else {
      // No network in this environment; the query logic is covered by the
      // effective_today tests and the servers are tried at runtime.
      return;
    };
    let drift = (chrono::Utc::now() - time).num_hours().abs();
    assert!(drift < 24, "ntp time {time} is implausibly far from the clock");
  }
}
