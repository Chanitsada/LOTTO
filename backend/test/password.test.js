const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { getPasswordError, hashPassword, comparePassword } = require('../utils/password');

test('hashes at cost 10 with a different salt for each hash', async () => {
  const password = 'DemoPassword123';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.equal(bcrypt.getRounds(first), 10);
  assert.equal(bcrypt.getRounds(second), 10);
  assert.notEqual(first, password);
  assert.notEqual(first, second);
  assert.equal(await bcrypt.compare(password, first), true);
});

test('matches the right password and rejects incorrect or invalid candidates', async () => {
  const hash = await hashPassword('DemoPassword123');
  assert.equal(await comparePassword('DemoPassword123', hash), true);
  assert.equal(await comparePassword('WrongPassword123', hash), false);
  for (const password of [null, undefined, 123, {}, [], 'short', 'a'.repeat(73)]) {
    assert.equal(await comparePassword(password, hash), false);
  }
  for (const invalidHash of [null, undefined, 123, {}, '', 'not-a-hash']) {
    assert.equal(await comparePassword('DemoPassword123', invalidHash), false);
  }
});

test('does not trim or normalize passwords', async () => {
  const password = '  DemoPassword123  ';
  const hash = await hashPassword(password);
  assert.equal(await comparePassword(password, hash), true);
  assert.equal(await comparePassword(password.trim(), hash), false);
});

test('rejects invalid passwords before hashing without including their values in errors', async () => {
  for (const password of [null, 123, {}, 'short', 'a'.repeat(73), 'ก'.repeat(25), '😀'.repeat(7)]) {
    await assert.rejects(() => hashPassword(password), TypeError);
  }
  const privateValue = 'PRIVATE_VALUE_'.repeat(8);
  await assert.rejects(() => hashPassword(privateValue), (error) => {
    assert.doesNotMatch(error.message, /PRIVATE_VALUE/);
    return true;
  });
});

test('accepts exact 72-byte ASCII and multibyte passwords without truncation collisions', async () => {
  for (const password of ['a'.repeat(72), 'ก'.repeat(24), '😀'.repeat(18)]) {
    assert.equal(Buffer.byteLength(password, 'utf8'), 72);
    assert.equal(getPasswordError(password), null);
    const hash = await hashPassword(password);
    assert.equal(await comparePassword(password, hash), true);
    assert.equal(await comparePassword(`${password}x`, hash), false);
    await assert.rejects(() => hashPassword(`${password}x`), TypeError);
  }
});
