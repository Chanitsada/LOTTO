import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from '../src/App'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container, root, fetchMock, postMock

beforeEach(async () => {
  window.history.replaceState({}, '', '/register')
  localStorage.clear()
  postMock = vi.fn()
  fetchMock = vi.fn((path, options) => {
    if (path === '/api/auth/me') return Promise.resolve(response(401, { error: { code: 'LOGIN_REQUIRED', message: 'Please sign in.' } }))
    if (path === '/api/auth/csrf') return Promise.resolve(response(200, { data: { csrfToken: 'csrf-test-token' } }))
    return postMock(path, options)
  })
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<App />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
})

function fillForm() {
  const values = {
    firstName: '  Demo  ', lastName: ' Customer ', phone: '0812345678',
    email: 'demo@example.com', password: ' DemoPassword123 ',
  }
  for (const [name, value] of Object.entries(values)) {
    container.querySelector(`[name="${name}"]`).value = value
  }
  return container.querySelector('form.register-form')
}

function submit(form) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

test('sends the four agreed fields, clears a successful form and stays logged out', async () => {
  postMock.mockResolvedValue(response(201, {
    data: { userId: 17, name: 'Demo Customer', role: 'Customer' },
  }))
  const form = fillForm()
  await act(async () => submit(form))

  expect(postMock).toHaveBeenCalledTimes(1)
  const [url, options] = postMock.mock.calls[0]
  expect(url).toBe('/api/auth/register')
  expect(options.method).toBe('POST')
  expect(options.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-test-token' })
  expect(options.credentials).toBe('same-origin')
  expect(JSON.parse(options.body)).toEqual({
    name: 'Demo Customer', phone: '0812345678', email: 'demo@example.com',
    password: ' DemoPassword123 ',
  })
  expect(container.querySelector('.login-form-message').textContent).toContain('Account created successfully')
  expect(form.elements.password.value).toBe('')
  expect(form.elements.email.value).toBe('')
  expect(window.location.pathname).toBe('/register')
  expect(localStorage.length).toBe(0)
  expect(form.querySelector('[type="submit"]').disabled).toBe(false)
  expect(form.elements.remember.disabled).toBe(true)
  expect(container.querySelector('.google-sign-in').disabled).toBe(true)
})

test('blocks repeated submissions and disables inputs until the response arrives', async () => {
  let resolveRequest
  postMock.mockReturnValue(new Promise(resolve => { resolveRequest = resolve }))
  const form = fillForm()
  await act(async () => { submit(form); submit(form) })
  expect(postMock).toHaveBeenCalledTimes(1)
  expect(form.getAttribute('aria-busy')).toBe('true')
  expect(form.elements.email.disabled).toBe(true)
  expect(form.querySelector('[type="submit"]').disabled).toBe(true)
  expect(form.querySelector('[type="submit"]').textContent).toBe('Creating…')
  await act(async () => resolveRequest(response(201, { data: { role: 'Customer' } })))
  expect(form.getAttribute('aria-busy')).toBe('false')
  expect(form.elements.email.disabled).toBe(false)
})

test.each([
  [400, 'Password must contain at least 8 characters.'],
  [409, 'An account with this email already exists.'],
  [500, 'An unexpected error occurred.'],
])('shows the API error for HTTP %s and keeps entered fields', async (status, message) => {
  postMock.mockResolvedValue(response(status, { error: { message } }))
  const form = fillForm()
  await act(async () => submit(form))
  expect(container.querySelector('.login-form-message').textContent).toBe(message)
  expect(form.elements.email.value).toBe('demo@example.com')
  expect(form.querySelector('[type="submit"]').disabled).toBe(false)
})

test('recovers after a network failure without claiming success', async () => {
  postMock.mockRejectedValue(new TypeError('Failed to fetch'))
  const form = fillForm()
  await act(async () => submit(form))
  expect(container.querySelector('.login-form-message').textContent).toContain('Check the connection')
  expect(form.elements.email.value).toBe('demo@example.com')
  expect(form.querySelector('[type="submit"]').disabled).toBe(false)
})

test('does not claim account creation for an unexpected success response', async () => {
  postMock.mockResolvedValue(response(200, { data: {} }))
  const form = fillForm()
  await act(async () => submit(form))
  expect(container.querySelector('.login-form-message').textContent).toContain('could not be confirmed')
  expect(form.elements.email.value).toBe('demo@example.com')
})
