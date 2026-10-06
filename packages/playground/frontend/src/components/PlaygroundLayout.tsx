import { Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtoolsInProd } from "@tanstack/react-router-devtools";
import type { JSX } from "react";
import logo from "../logo.svg";
import reactLogo from "../react.svg";

export function PlaygroundLayout(): JSX.Element {
  return (
    <main className="app">
      <div className="logo-container">
        <img src={logo} alt="Bun Logo" className="logo bun-logo" />
        <img src={reactLogo} alt="React Logo" className="logo react-logo" />
      </div>
      <h1>Devtools playground</h1>
      <p>Use the Router and Query buttons in the devhost overlay to inspect this app.</p>
      <nav className="playground-navigation" aria-label="Playground">
        <Link to="/" activeOptions={{ exact: true }}>
          API tester
        </Link>
        <Link to="/query">Query demo</Link>
      </nav>
      <Outlet />
      <TanStackRouterDevtoolsInProd initialIsOpen={false} />
    </main>
  );
}
