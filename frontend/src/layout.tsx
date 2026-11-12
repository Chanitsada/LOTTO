import React, { useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './auth'

const asset = (name: string) => `/assets/${name}`

// Default navigation links serve visitors and Customers.
const navItems = [
  ["Draw Results", "/results"],
  ["Buy Lottery", "/buy-lottery"],
] as const

const steps = [
  {
    label: "Choose a number and how many entries you would like",
    icon: "touch",
  },
  {
    label: "Head to check out and complete payment",
    icon: "080fc.svg",
  },
  {
    label:
      "Tickets are entered into the draw, and can be viewed in your profile",
    icon: "5191a.svg",
  },
  {
    label:
      "Check published results and per-copy winnings in ticket history.",
    icon: "7a467.svg",
  },
] as const


export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <a
      className={`logo${inverse ? " logo--inverse" : ""}`}
      href="/"
      aria-label="Lotto home"
    >
      LOT<span>to</span>
    </a>
  )
}

export function Button({
  children,
  href,
  type = "button",
  disabled = false,
}: {
  children: React.ReactNode
  href?: string
  type?: "button" | "submit"
  disabled?: boolean
}) {
  if (href) {
    return (
      <a className="button" href={href}>
        {children}
      </a>
    )
  }

  return (
    <button className="button" type={type} disabled={disabled}>
      {children}
    </button>
  )
}

function TouchIcon() {
  return (
    <span className="touch-icon" aria-hidden="true">
      <img src={asset("c451d.svg")} alt="" />
      <img src={asset("10ef9.svg")} alt="" />
      <img src={asset("cd27c.svg")} alt="" />
      <img src={asset("d1e8b.svg")} alt="" />
      <img src={asset("52058.svg")} alt="" />
    </span>
  )
}

export function Header({ className = "header" }: { className?: string }) {
  const auth = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)
  const logoutPending = useRef(false)
  async function handleLogout() {
    if (logoutPending.current) return
    logoutPending.current = true
    setLoggingOut(true)
    try { await auth.logout() } catch { /* The shared auth state displays the error. */ }
    finally { logoutPending.current = false; setLoggingOut(false) }
  }
  const [menuOpen, setMenuOpen] = useState(false)
  const admin = useLocation().pathname.startsWith('/admin')
  const links = admin
    ? [['Dashboard', '/admin'], ['Draws', '/admin/draw'], ['Draw board', '/admin/live-draw'], ['Draw Results', '/results']]
    : [...navItems, ...(auth.user?.role === 'Customer' ? [['My Tickets', '/cart'], ['Your Cart', '/checkout']] : []), ...(auth.user?.role === 'Admin' ? [['Dashboard', '/admin']] : []), ...(auth.user?.role === 'Developer' ? [['Inventory report', '/developer']] : [])]
  return (
    <header className={className}>
      <div className="header__inner">
        <Logo />
        <button className="menu-toggle" type="button" aria-label="Toggle navigation"
          aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
          <span /><span /><span />
        </button>
        <nav className={`nav${menuOpen ? ' nav--open' : ''}`} aria-label="Main navigation">
          {links.map(([label, href]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
        </nav>
        <div className="account-actions">
          {auth.loading ? <span>Checking login…</span> : auth.user ? <>
            <a className="login-link" href="/profile">{auth.user.name || 'My account'}</a>
            <button className="button" type="button" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? 'Logging out…' : 'Logout'}
            </button>
          </> : <>
            <a className="login-link" href="/login" style={{ display: 'inline-flex' }}>Login</a>
            <Button href="/register">Register</Button>
          </>}
          {auth.error && <p role="status">{auth.error}</p>}
        </div>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <Logo inverse />
        <div className="payment-marks" aria-label="Simulated payments only">
          <img className="promptpay" src={asset('e804f.png')} alt="PromptPay illustration" />
          {['99c87.svg', 'b250f.svg', '0a2b7.svg', '4182d.svg', '009a9.svg'].map(name => <img key={name} src={asset(name)} alt="" />)}
        </div>
        <nav className="footer__nav" aria-label="Footer navigation">
          {navItems.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
        </nav>
      </div>
    </footer>
  )
}

export function How() {
  return (<section className="how" id="how-it-works">
    <h2>How it works</h2>
    <div className="steps">
      <img
        className="steps__arrows"
        src={asset("55a04.svg")}
        alt=""
        aria-hidden="true"
      />
      {steps.map((step) => (
        <article className="step" key={step.label}>
          {step.icon === "touch" ? (
            <TouchIcon />
          ) : (
            <img className="step__icon" src={asset(step.icon)} alt="" />
          )}
          <p>{step.label}</p>
        </article>
      ))}
    </div>
  </section>
  )
}

