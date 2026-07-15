/**
 * @module utils/crypto
 * @description AES-256-GCM encryption utilities with PBKDF2 key derivation.
 * Each encryption generates a unique random salt and IV, producing a
 * combined hex string of the form: salt:iv:authTag:ciphertext.
 */

'use strict';

const crypto = require('crypto');

/** @constant {string} ALGORITHM - Cipher algorithm. */
const ALGORITHM = 'aes-256-gcm';

/** @constant {number} KEY_LENGTH - Derived key length in bytes. */
const KEY_LENGTH = 32;

/** @constant {number} IV_LENGTH - Initialisation vector length in bytes. */
const IV_LENGTH = 16;

/** @constant {number} SALT_LENGTH - Random salt length in bytes. */
const SALT_LENGTH = 32;

/** @constant {number} TAG_LENGTH - GCM authentication tag length in bytes. */
const TAG_LENGTH = 16;

/** @constant {number} PBKDF2_ITERATIONS - PBKDF2 iteration count. */
const PBKDF2_ITERATIONS = 100000;

/** @constant {string} PBKDF2_DIGEST - PBKDF2 hash function. */
const PBKDF2_DIGEST = 'sha512';

/**
 * Derive a 256-bit key from a passphrase and salt using PBKDF2.
 * @param {string} passphrase - The master passphrase.
 * @param {Buffer} salt       - Random salt.
 * @returns {Buffer} 32-byte derived key.
 */
function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(
    passphrase,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  );
}

/**
 * Encrypt plaintext using AES-256-GCM with a passphrase.
 *
 * A fresh random salt and IV are generated for every call, ensuring that
 * identical plaintexts produce different ciphertexts.
 *
 * @param {string} text       - The plaintext to encrypt.
 * @param {string} passphrase - The master passphrase.
 * @returns {string} Combined hex string in the format `salt:iv:tag:encrypted`.
 * @throws {Error} If text or passphrase is empty.
 *
 * @example
 *   const { encrypt, decrypt } = require('./crypto');
 *   const token = encrypt('mySecret', 'masterPass');
 *   const plain = decrypt(token, 'masterPass');
 *   // plain === 'mySecret'
 */
function encrypt(text, passphrase) {
  if (!text) throw new Error('encrypt: text must not be empty');
  if (!passphrase) throw new Error('encrypt: passphrase must not be empty');

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  // salt:iv:tag:ciphertext  — all hex-encoded
  return [
    salt.toString('hex'),
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted,
  ].join(':');
}

/**
 * Decrypt a combined hex string produced by {@link encrypt}.
 *
 * @param {string} combined   - The `salt:iv:tag:encrypted` hex string.
 * @param {string} passphrase - The master passphrase used during encryption.
 * @returns {string} The original plaintext.
 * @throws {Error} If the combined string is malformed or decryption fails
 *   (wrong passphrase, tampered data, etc.).
 *
 * @example
 *   const plain = decrypt(token, 'masterPass');
 */
function decrypt(combined, passphrase) {
  if (!combined) throw new Error('decrypt: combined string must not be empty');
  if (!passphrase) throw new Error('decrypt: passphrase must not be empty');

  const parts = combined.split(':');
  if (parts.length !== 4) {
    throw new Error('decrypt: malformed combined string — expected salt:iv:tag:encrypted');
  }

  const [saltHex, ivHex, tagHex, encrypted] = parts;

  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const key = deriveKey(passphrase, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

module.exports = { encrypt, decrypt };
