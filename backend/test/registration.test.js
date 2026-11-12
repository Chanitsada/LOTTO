const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRegistration } = require('../utils/registration');
const { errorHandler } = require('../middleware/error-handler');

function validInput(overrides = {}) {
  return {
    name: 'Demo Customer',
    phone: '0812345678',
    email: 'customer@example.com',
    password: 'DemoPassword123',
    ...overrides,
  };
}

function rejectsInput(body) {
  assert.throws(() => validateRegistration(body), { code: 'VALIDATION_ERROR' });
}

test('accepts registration data, trims contact fields and preserves password and input', () => {
  const input = validInput({
    name: '  Demo Customer  ',
    phone: '  +66 81 234 5678  ',
    email: '  Customer@example.com  ',
    password: ' password with spaces ',
  });
  const original = { ...input };
  assert.deepEqual(validateRegistration(input), {
    name: 'Demo Customer',
    phone: '+66 81 234 5678',
    email: 'Customer@example.com',
    password: ' password with spaces ',
  });
  assert.deepEqual(input, original);
});

test('rejects invalid body types', () => {
  for (const body of [undefined, null, [], '', 10, true]) {
    rejectsInput(body);
  }
});

test('requires every field to be an own string property', () => {
  for (const field of ['name', 'phone', 'email', 'password']) {
    const missing = validInput();
    delete missing[field];
    rejectsInput(missing);
    for (const value of [null, 123, false, [], {}]) {
      rejectsInput(validInput({ [field]: value }));
    }
  }
  rejectsInput(Object.create(validInput()));
});

test('rejects extra fields and every requested role, including Customer', () => {
  for (const role of ['Admin', 'Developer', 'Customer', null]) {
    rejectsInput(validInput({ role }));
  }
  for (const extra of [{ userId: 1 }, { isActive: true }, { passwordHash: 'fake' }]) {
    rejectsInput(validInput(extra));
  }
});

test('enforces trimmed name and phone boundaries with Unicode names', () => {
  for (const name of ['', '   ', 'a'.repeat(101)]) rejectsInput(validInput({ name }));
  for (const phone of ['', '   ', '1'.repeat(21)]) rejectsInput(validInput({ phone }));
  assert.equal(validateRegistration(validInput({ name: 'ก'.repeat(100), phone: '1'.repeat(20) })).name.length, 100);
  assert.equal(validateRegistration(validInput({ name: 'A', phone: '1' })).name, 'A');
});

test('checks email format and its maximum length without changing case', () => {
  for (const email of ['', 'person', 'person@', '@example.com', 'a@@example.com', 'a b@example.com', 'a@example', 'a@example.com\nextra']) {
    rejectsInput(validInput({ email }));
  }
  const maximum = `${'a'.repeat(242)}@example.com`;
  assert.equal(maximum.length, 254);
  assert.equal(validateRegistration(validInput({ email: maximum })).email, maximum);
  rejectsInput(validInput({ email: `a${maximum}` }));
  assert.equal(validateRegistration(validInput({ email: 'Name+demo@Example.com' })).email, 'Name+demo@Example.com');
});

test('enforces password characters and UTF-8 bytes independently', () => {
  rejectsInput(validInput({ password: '1234567' }));
  assert.equal(validateRegistration(validInput({ password: '12345678' })).password, '12345678');
  assert.equal(validateRegistration(validInput({ password: 'a'.repeat(72) })).password.length, 72);
  rejectsInput(validInput({ password: 'a'.repeat(73) }));
  rejectsInput(validInput({ password: '😀'.repeat(7) }));
  assert.equal(validateRegistration(validInput({ password: '😀'.repeat(8) })).password, '😀'.repeat(8));
  assert.equal(Buffer.byteLength('ก'.repeat(24), 'utf8'), 72);
  assert.equal(validateRegistration(validInput({ password: 'ก'.repeat(24) })).password, 'ก'.repeat(24));
  rejectsInput(validInput({ password: 'ก'.repeat(25) }));
});

test('validation errors become safe JSON 400 responses without echoing submitted values', () => {
  const privateValue = 'PRIVATE_SUBMITTED_VALUE';
  let error;
  try {
    validateRegistration(validInput({ password: privateValue.repeat(5), role: privateValue }));
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  let status;
  let payload;
  const res = {
    headersSent: false,
    status(value) { status = value; return this; },
    json(value) { payload = value; return this; },
  };
  errorHandler(error, {}, res, () => assert.fail('Validation must be handled'));
  assert.equal(status, 400);
  assert.equal(payload.error.code, 'VALIDATION_ERROR');
  assert.doesNotMatch(JSON.stringify(payload), new RegExp(privateValue));
  assert.equal(Object.hasOwn(payload.error, 'stack'), false);
});

test('unexpected errors still return a generic 500 without private error contents', () => {
  let status;
  let payload;
  const res = {
    headersSent: false,
    status(value) { status = value; return this; },
    json(value) { payload = value; return this; },
  };
  errorHandler(new Error('PRIVATE_DATABASE_OR_PASSWORD_VALUE'), {}, res, () => assert.fail('Error must be handled'));
  assert.equal(status, 500);
  assert.deepEqual(payload, {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
});
