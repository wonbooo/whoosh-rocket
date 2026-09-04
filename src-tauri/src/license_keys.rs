/// Ed25519 public key (32 bytes, standard base64). Used only to verify licenses.
pub const PUBLIC_KEY_B64: &str = "vuEzI5kqqeMjsmexz7y6Ap90U+eKgBwcTvKtJmlNWWA=";

/// Encrypted signing seed: salt(16) || nonce(12) || ciphertext(32) || tag(16).
/// Sealed with PBKDF2-SHA256 (100_000) + AES-256-GCM. Password is not in this repo.
pub const ENCRYPTED_SEED_B64: &str = "assLY5MOWTe6Rr71HRuyfw5QTgHH/vtv3iYa5JdUi9Jam+fXTgOkkNOpyIBz4FWeFzdcxIQAWi2lRTqGlL2WPfXfted41wzcTBgq2g==";

pub const PBKDF2_ITERS: u32 = 100_000;
