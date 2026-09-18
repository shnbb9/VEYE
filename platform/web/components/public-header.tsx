"use client";

import Link from "next/link";
import { useState } from "react";

export function PublicHeader({ active }: { active: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return <>
    <div className="announce"><div className="announce__track">{Array.from({ length: 6 }, (_, index) => <span className="announce__item" key={index}>Notifications, Offers, Announcements, VIP Specials</span>)}</div></div>
    <header className="nav"><div className="container nav__inner">
      <Link className="nav__logo" href="/" aria-label="Veye home" onClick={closeMenu}><img src="/assets/web/wp/veye-id.svg" alt="Veye" /></Link>
      <ul className={`nav__links${menuOpen ? " open" : ""}`} id="navLinks">
        <li><Link className={active === "home" ? "is-active" : ""} href="/#how-it-works" onClick={closeMenu}>How it works</Link></li>
        <li><Link className={active === "why" ? "is-active" : ""} href="/why-veye" onClick={closeMenu}>Why Veye</Link></li>
        <li><Link className={active === "pricing" ? "is-active" : ""} href="/pricing" onClick={closeMenu}>Pricing</Link></li>
        <li><Link className={active === "help" ? "is-active" : ""} href="/help" onClick={closeMenu}>Help</Link></li>
        <li><Link className={active === "about" ? "is-active" : ""} href="/about" onClick={closeMenu}>About</Link></li>
      </ul>
      <div className="nav__right">
        <Link className="nav__user" href="/login" aria-label="Sign in"><img src="/assets/web/svg/user.svg" alt="" /></Link>
        <Link className="nav__cta" href="/onboarding"><span>Get Started</span><span className="nav__cta-box" /></Link>
        <button className="nav__burger" id="navBurger" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><span /><span /><span /></button>
      </div>
    </div></header>
  </>;
}
