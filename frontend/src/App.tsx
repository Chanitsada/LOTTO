import React, { type FormEvent, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { ApiError, apiPost } from './api'
import { Logo, Button, Header, Footer } from './layout'
import { HomePage, ResultsPage, ProfilePage, BuyLotteryPage, CartPage, CheckoutPage } from './lottery-pages'
import { AdminDashboardPage, AdminDrawPage, AdminLiveDrawPage } from './admin-pages'
import { DeveloperPage } from './developer-page'
const asset = (name: string) => '/assets/' + name

function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [loginMessage, setLoginMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitting = useRef(false)
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const form = event.currentTarget
    const fields = new FormData(form)
    submitting.current = true
    setIsSubmitting(true)
    setLoginMessage('')
    try {
      await auth.login(String(fields.get('email') ?? ''), String(fields.get('password') ?? ''))
      form.reset()
      navigate('/profile', { replace: true })
    } catch (failure) {
      setLoginMessage(failure instanceof ApiError ? failure.message : 'Could not sign in. Check the connection and try again.')
    } finally {
      submitting.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <header className="login-header">
        <Logo />
      </header>

      <main className="login-layout">
        <section className="login-benefits">
          <div className="login-benefits__content">
            <h1>
              <span>Pick your numbers, </span>
              buy your ticket, and watch the draw.
            </h1>
            <ul>
              {[
                "Choose your own six numbers or quick pick them in one tap. buying a ticket takes under a minute.",
                "View published results, receipts and ticket history in your account.",
                "See every past draw's winning numbers archived in one place.",
                "Every ticket and payment is stored securely, and your personal details are never shared or sold.",
              ].map((benefit) => (
                <li key={benefit}>
                  <img src={asset("c2117.svg")} alt="" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
            <p className="login-benefits__help">
              Sign in with a registered account. Sessions expire after 30 minutes of inactivity.
            </p>
          </div>
        </section>

        <section className="login-form-panel" aria-labelledby="sign-in-title">
          <div className="login-form-panel__inner">
            <div className="login-form-panel__heading">
              <h2 id="sign-in-title">Sign in</h2>
              <p>Enter your login details to sign in</p>
            </div>

            {auth.user && <p>You are already signed in. <a href="/profile">View my account</a>.</p>}
            <form className="sign-in-form" onSubmit={handleLogin} aria-busy={isSubmitting}>
              <label>
                <span>Email</span>
                <span className="auth-input">
                  <img src={asset("1d21e.svg")} alt="" />
                  <input
                    type="email"
                    name="email"
                    placeholder="example@gmail.com"
                    autoComplete="username"
                    maxLength={254}
                    disabled={isSubmitting}
                    required
                  />
                </span>
              </label>
              <label>
                <span>Password</span>
                <span className="auth-input">
                  <img src={asset("dc44a.svg")} alt="" />
                  <input
                    type="password"
                    name="password"
                    placeholder="● ● ● ● ● ● ● ●"
                    autoComplete="current-password"
                    minLength={8}
                    disabled={isSubmitting}
                    required
                  />
                </span>
              </label>

              <div className="sign-in-form__options">
                <label className="remember-me">
                  <input type="checkbox" name="remember" disabled />
                  <span>Remember me</span>
                </label>
                <span>Password reset unavailable</span>
              </div>

              <button className="sign-in-form__submit" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>
              <p className="login-form-message" aria-live="polite">
                {loginMessage}
              </p>
            </form>

            <p className="sign-up-prompt">
              Don’t have an account yet? <a href="/register">Sign up</a>
            </p>

            <div className="auth-divider">
              <img src={asset("95080.svg")} alt="" />
              <span>Or continue with</span>
              <img src={asset("95080.svg")} alt="" />
            </div>

            <button
              className="google-sign-in"
              type="button"
              disabled
            >
              <img src={asset("08fff.svg")} alt="" />
              <span>Sign in with Google</span>
            </button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}

function RegisterPage() {
  const [registerMessage, setRegisterMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submitting = useRef(false)

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return

    const form = event.currentTarget
    const fields = new FormData(form)
    const payload = {
      name: [fields.get('firstName'), fields.get('lastName')]
        .map(value => String(value ?? '').trim()).filter(Boolean).join(' '),
      phone: String(fields.get('phone') ?? ''),
      email: String(fields.get('email') ?? ''),
      password: String(fields.get('password') ?? ''),
    }

    submitting.current = true
    setIsSubmitting(true)
    setRegisterMessage('')
    try {
      const result = await apiPost('/api/auth/register', payload)
      if (result.status !== 201 || result.data?.role !== 'Customer') {
        setRegisterMessage('Account creation could not be confirmed. Please try again.')
        return
      }
      form.reset()
      setRegisterMessage('Account created successfully. Sign in with the new account.')
    } catch (failure) {
      setRegisterMessage(failure instanceof ApiError ? failure.message : 'Could not complete registration. Check the connection and try again.')
    } finally {
      submitting.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="login-page register-page">
      <header className="login-header">
        <Logo />
      </header>

      <main className="login-layout">
        <section className="login-benefits">
          <div className="login-benefits__content">
            <h1>
              <span>Pick your numbers, </span>
              buy your ticket, and watch the draw.
            </h1>
            <ul>
              {[
                "Choose your own six numbers or quick pick them in one tap. buying a ticket takes under a minute.",
                "View published results and ticket history when backend integration is complete.",
                "See every past draw's winning numbers archived in one place.",
                "Every ticket and payment is stored securely, and your personal details are never shared or sold.",
              ].map((benefit) => (
                <li key={benefit}>
                  <img src={asset("e6a88.svg")} alt="" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
            <p className="login-benefits__help">
              Create a Customer account, then sign in to view account details.
            </p>
          </div>
        </section>

        <section
          className="login-form-panel register-form-panel"
          aria-labelledby="register-title"
        >
          <div className="login-form-panel__inner">
            <div className="login-form-panel__heading">
              <h2 id="register-title">Create an account</h2>
              <p>Use a new email address and a password with at least 8 characters.</p>
            </div>

            <form
              className="sign-in-form register-form"
              onSubmit={handleRegister}
              aria-busy={isSubmitting}
            >
              <div className="register-form__names">
                <label>
                  <span>First Name</span>
                  <span className="auth-input">
                    <img src={asset("07ba9.svg")} alt="" />
                    <input
                      type="text"
                      name="firstName"
                      placeholder="First Name"
                      autoComplete="given-name"
                      disabled={isSubmitting}
                      required
                    />
                  </span>
                </label>
                <label>
                  <span>Last Name</span>
                  <span className="auth-input">
                    <img src={asset("07ba9.svg")} alt="" />
                    <input
                      type="text"
                      name="lastName"
                      placeholder="Last Name"
                      autoComplete="family-name"
                      disabled={isSubmitting}
                      required
                    />
                  </span>
                </label>
              </div>

              <label>
                <span>Phone</span>
                <span className="auth-input">
                  <img src={asset("a9f4e.svg")} alt="" />
                  <input
                    type="tel"
                    name="phone"
                    placeholder="+66"
                    autoComplete="tel"
                    maxLength={20}
                    disabled={isSubmitting}
                    required
                  />
                </span>
              </label>

              <label>
                <span>Email</span>
                <span className="auth-input">
                  <img src={asset("e5123.svg")} alt="" />
                  <input
                    type="email"
                    name="email"
                    placeholder="example@gmail.com"
                    autoComplete="email"
                    maxLength={254}
                    disabled={isSubmitting}
                    required
                  />
                </span>
              </label>

              <label>
                <span>Password</span>
                <span className="auth-input">
                  <img src={asset("3e466.svg")} alt="" />
                  <input
                    type="password"
                    name="password"
                    placeholder="● ● ● ● ● ● ● ●"
                    autoComplete="new-password"
                    minLength={8}
                    disabled={isSubmitting}
                    required
                  />
                </span>
              </label>

              <div className="register-form__remember">
                <label className="remember-me">
                  <input type="checkbox" name="remember" disabled />
                  <span>Remember me</span>
                </label>
              </div>

              <button className="sign-in-form__submit" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating…' : 'Create'}
              </button>
              <p className="login-form-message" aria-live="polite">
                {registerMessage}
              </p>
              <p className="sign-up-prompt">Already registered? <a href="/login">Sign in</a>.</p>
            </form>

            <div className="auth-divider">
              <img src={asset("95080.svg")} alt="" />
              <span>Or continue with</span>
              <img src={asset("95080.svg")} alt="" />
            </div>

            <button
              className="google-sign-in"
              type="button"
              disabled
            >
              <img src={asset("08fff.svg")} alt="" />
              <span>Sign in with Google</span>
            </button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/buy-lottery" element={<BuyLotteryPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/admin" element={<AdminDashboardPage />} />
        <Route path="/admin/draw" element={<AdminDrawPage />} />
        <Route path="/admin/live-draw" element={<AdminLiveDrawPage />} />
        <Route path="/developer" element={<DeveloperPage />} />
      </Routes>
    </BrowserRouter>
    </AuthProvider>
  );
}

export default App
