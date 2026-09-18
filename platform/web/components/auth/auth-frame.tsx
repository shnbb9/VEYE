"use client";

import { useState, type ReactNode } from "react";

/* The approved sign-in / sign-up screens (build/login.html, build/signup.html,
   styles/auth.css, Figma "Desk Onboard A"): photo panel with the white logo
   and the vertical "Nutrition Reimagined" tagline, and the cream form panel.
   The stylesheet is the prototype's own file served from /auth-css. */

export function AuthFrame({ photo, children }: { photo: "login" | "signup"; children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Teachers:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <link rel="stylesheet" href="/onboarding-css/tokens.css" />
      <link rel="stylesheet" href="/onboarding-css/base.css" />
      <link rel="stylesheet" href="/auth-css/auth.css" />
      <link rel="stylesheet" href="/auth-css/auth-app.css" />
      <main className="auth">
        <section className="auth__media">
          <img className="auth__photo" src={photo === "login" ? "/auth/login-people.jpg" : "/auth/signup-bowl.jpg"} alt="" />
          <img className="auth__logo" src="/auth/veye-logo-white.svg" alt="Veye" />
          <span className="auth__tagline">Nutrition Reimagined</span>
        </section>
        <section className="auth__panel">{children}</section>
      </main>
    </>
  );
}

const EyeOn = () => (
  <svg className="icon-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l18 18" /><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c7 0 10.5 7 10.5 7a18.3 18.3 0 0 1-3.4 4.1M6.5 8.3A18.2 18.2 0 0 0 1.5 12S5 19 12 19c1.4 0 2.7-.3 4-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
);
const EyeOff = () => (
  <svg className="icon-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

export function PasswordField({ value, onChange, placeholder, autoComplete, name }: {
  value: string; onChange: (value: string) => void; placeholder: string; autoComplete: string; name: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <input className="field__input" type={shown ? "text" : "password"} placeholder={placeholder} autoComplete={autoComplete}
             value={value} onChange={(event) => onChange(event.target.value)} aria-label={placeholder} name={name} />
      <button type="button" className={`field__eye${shown ? " is-on" : ""}`} aria-label={shown ? "Hide password" : "Show password"}
              onClick={() => setShown((open) => !open)}>
        <EyeOn /><EyeOff />
      </button>
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return <p className="auth__error" role="alert">{message}</p>;
}
