import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from '../src/App'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container, root, fetchMock, loginMock, user
const customer = { userId: 17, name: 'Demo Customer', role: 'Customer' }
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

beforeEach(async () => {
  window.history.replaceState({}, '', '/login')
  localStorage.clear()
  user = null
  loginMock = vi.fn(async () => {
    user = customer
    return response(200, { data: user })
  })
  fetchMock = vi.fn(async (path, options) => {
    if (path === '/api/auth/me') return user ? response(200, { data: user }) : response(401, {
      error: { code: 'LOGIN_REQUIRED', message: 'Please sign in.' },
    })
    if (path === '/api/auth/csrf') return response(200, { data: { csrfToken: user ? 'new-token' : 'anonymous-token' } })
    if (path === '/api/auth/login') return loginMock(path, options)
    if (path === '/api/auth/logout') { user = null; return response(200, { data: { message: 'Logged out.' } }) }
    throw new Error('Unexpected request: ' + path)
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
  const form = container.querySelector('form.sign-in-form')
  form.elements.email.value = ' demo@example.com '
  form.elements.password.value = ' DemoPassword123 '
  return form
}
const submit = form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

test('signs in with CSRF, opens the account page and restores the session after remount', async () => {
  await act(async () => submit(fillForm()))
  const [, options] = loginMock.mock.calls[0]
  expect(JSON.parse(options.body)).toEqual({ email: 'demo@example.com', password: ' DemoPassword123 ' })
  expect(options.credentials).toBe('same-origin')
  expect(options.headers['X-CSRF-Token']).toBe('anonymous-token')
  expect(window.location.pathname).toBe('/profile')
  expect(container.textContent).toContain('Signed in as Demo Customer')
  expect(fetchMock.mock.calls.filter(([path]) => path === '/api/auth/csrf')).toHaveLength(2)
  expect(localStorage.length).toBe(0)
  await act(async () => root.unmount())
  root = createRoot(container)
  await act(async () => root.render(<App />))
  expect(container.textContent).toContain('Signed in as Demo Customer')
})

test('blocks repeated submissions while login is pending', async () => {
  let resolveLogin
  loginMock.mockReturnValue(new Promise(resolve => { resolveLogin = resolve }))
  const form = fillForm()
  await act(async () => { submit(form); submit(form) })
  expect(loginMock).toHaveBeenCalledTimes(1)
  expect(form.querySelector('[type="submit"]').disabled).toBe(true)
  expect(form.querySelector('[type="submit"]').textContent).toBe('Signing in…')
  expect(form.elements.email.disabled).toBe(true)
  await act(async () => resolveLogin(response(401, { error: { message: 'Email or password is incorrect.' } })))
  expect(form.querySelector('[type="submit"]').disabled).toBe(false)
})

test.each([
  [401, 'Email or password is incorrect.'],
  [403, 'This account is deactivated.'],
  [429, 'Too many sign-in attempts. Try again in 15 minutes.'],
  [503, 'Configure authentication first.'],
])('shows HTTP %s errors and allows correction', async (status, message) => {
  loginMock.mockResolvedValue(response(status, { error: { message } }))
  const form = fillForm()
  await act(async () => submit(form))
  expect(container.querySelector('.login-form-message').textContent).toBe(message)
  expect(form.elements.password.value).toBe(' DemoPassword123 ')
  expect(form.querySelector('[type="submit"]').disabled).toBe(false)
  expect(window.location.pathname).toBe('/login')
})

test('network errors do not claim successful login', async () => {
  loginMock.mockRejectedValue(new TypeError('Failed to fetch'))
  const form = fillForm()
  await act(async () => submit(form))
  expect(container.querySelector('.login-form-message').textContent).toContain('Check the connection')
  expect(form.querySelector('[type="submit"]').disabled).toBe(false)
})

test('logout sends the current token and clears the account state', async () => {
  await act(async () => submit(fillForm()))
  const logout = [...container.querySelectorAll('button')].find(button => button.textContent === 'Logout')
  await act(async () => logout.click())
  const [, options] = fetchMock.mock.calls.find(([path]) => path === '/api/auth/logout')
  expect(options.headers['X-CSRF-Token']).toBe('new-token')
  expect(JSON.parse(options.body)).toEqual({})
  expect(container.textContent).toContain('No active login session.')
  expect(container.textContent).not.toContain('Signed in as Demo Customer')
  expect(localStorage.length).toBe(0)
})

test('an expired session restores the logged-out page and unfinished options remain disabled', async () => {
  expect(container.querySelector('[name="remember"]').disabled).toBe(true)
  expect(container.querySelector('.google-sign-in').disabled).toBe(true)
  window.history.replaceState({}, '', '/profile')
  await act(async () => root.unmount())
  root = createRoot(container)
  await act(async () => root.render(<App />))
  expect(container.textContent).toContain('No active login session.')
})
