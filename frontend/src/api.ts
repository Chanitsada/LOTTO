export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message)
  }
}

export type Pagination = { page: number; pageSize: number; totalItems: number }

async function readResponse(response: Response, path: string) {
  let result
  try { result = await response.json() }
  catch { throw new Error('The server returned an unreadable response. Check the connection.') }
  if (!response.ok) {
    if (path !== '/api/auth/me' && (result?.error?.code === 'LOGIN_REQUIRED' || result?.error?.code === 'ACCOUNT_DISABLED')) {
      window.dispatchEvent(new CustomEvent('lotto:session-expired'))
    }
    throw new ApiError(
      typeof result?.error?.message === 'string' ? result.error.message : 'Request failed. Please try again.',
      response.status, result?.error?.code ?? 'REQUEST_FAILED',
    )
  }
  if (!result || !Object.prototype.hasOwnProperty.call(result, 'data')) throw new Error('The server returned an incomplete response.')
  return result
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const result = await readResponse(await fetch(path, { credentials: 'same-origin', cache: 'no-store' }), path)
  return result.data
}

export async function apiList<T>(path: string): Promise<{ items: T[]; meta: Pagination }> {
  const result = await readResponse(await fetch(path, { credentials: 'same-origin', cache: 'no-store' }), path)
  if (!Array.isArray(result.data?.items) || !result.meta) throw new Error('The server returned an incomplete list.')
  return { ...result.data, meta: result.meta }
}

export async function apiMutation<T = any>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>): Promise<{ status: number; data: T }> {
  // Each mutation obtains a token for the current cookie session, including after login.
  const { csrfToken } = await apiGet('/api/auth/csrf')
  if (typeof csrfToken !== 'string') throw new Error('Could not prepare the form.')
  const response = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await readResponse(response, path)
  return { status: response.status, data: result.data }
}

export const apiPost = <T = any>(path: string, body: Record<string, unknown>) => apiMutation<T>(path, 'POST', body)
export const apiPatch = <T = any>(path: string, body: Record<string, unknown>) => apiMutation<T>(path, 'PATCH', body)
export const apiDelete = (path: string) => apiMutation(path, 'DELETE')
