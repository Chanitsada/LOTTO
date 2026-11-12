import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { ApiError, apiGet, apiPost } from './api'

type User = { userId: number; name: string; role: 'Customer' | 'Admin' | 'Developer' }
type Auth = {
  user: User | null
  loading: boolean
  error: string
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}
const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const expire = () => { setUser(null); setError('Please sign in again.') }
    window.addEventListener('lotto:session-expired', expire)
    return () => window.removeEventListener('lotto:session-expired', expire)
  }, [])

  useEffect(() => {
    let active = true
    apiGet('/api/auth/me').then(data => {
      if (active) setUser(data)
    }).catch(failure => {
      if (active && !(failure instanceof ApiError && failure.status === 401)) {
        setError(failure instanceof ApiError ? failure.message : 'Could not check the login session.')
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function login(email: string, password: string) {
    const { data } = await apiPost('/api/auth/login', { email, password })
    // Login creates a new session ID and CSRF token.
    await apiGet('/api/auth/csrf')
    setUser(data)
    setError('')
  }

  async function logout() {
    try {
      await apiPost('/api/auth/logout', {})
      setUser(null)
      setError('')
    } catch (failure) {
      if (failure instanceof ApiError && [401, 403].includes(failure.status) &&
          failure.code !== 'INVALID_CSRF_TOKEN') {
        setUser(null)
        setError('Please sign in again.')
        return
      }
      setError(failure instanceof ApiError ? failure.message : 'Could not log out. Please try again.')
      throw failure
    }
  }

  async function refresh() { setUser(await apiGet('/api/auth/me')) }

  return <AuthContext.Provider value={{ user, loading, error, login, logout, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('AuthProvider is required.')
  return auth
}
