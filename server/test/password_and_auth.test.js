import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../db.js';

describe('Authentication & Password Security', () => {
  test('hashPassword produces salted bcrypt hashes', () => {
    const password = 'mySecretPassword123';
    const hash1 = hashPassword(password);
    const hash2 = hashPassword(password);

    assert.ok(hash1.startsWith('$2a$') || hash1.startsWith('$2b$'), 'Hash should be valid bcrypt format');
    assert.notEqual(hash1, password, 'Hash must not equal plaintext');
    // Salting ensures identical passwords have distinct hashes
    assert.notEqual(hash1, hash2, 'Bcrypt should generate unique salts for each hash');
  });

  test('verifyPassword verifies bcrypt hashes accurately', () => {
    const password = 'adminPassword456';
    const hash = hashPassword(password);

    assert.equal(verifyPassword(password, hash), true, 'Valid password should verify');
    assert.equal(verifyPassword('wrongPassword', hash), false, 'Incorrect password must be rejected');
    assert.equal(verifyPassword('', hash), false, 'Empty password must be rejected');
    assert.equal(verifyPassword(password, ''), false, 'Empty hash must be rejected');
  });

  test('verifyPassword supports legacy SQLite plaintext fallback for smooth migration', () => {
    const legacyPlain = 'admin123';
    // When reading existing unhashed data from SQLite
    assert.equal(verifyPassword('admin123', legacyPlain), true, 'Legacy plaintext must match');
    assert.equal(verifyPassword('wrong', legacyPlain), false, 'Wrong password against legacy plaintext must fail');
  });

  test('Password hashing prevents SQL injection payloads in passwords', () => {
    const injectionAttempt = "' OR '1'='1' -- ";
    const hash = hashPassword(injectionAttempt);
    assert.ok(hash.startsWith('$2a$') || hash.startsWith('$2b$'), 'Payload should hash safely');
    assert.equal(verifyPassword(injectionAttempt, hash), true);
    assert.equal(verifyPassword("' OR '1'='2' -- ", hash), false);
  });
});
