import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, NavLink, Outlet, RouterProvider, useLocation } from "react-router-dom";
import { api } from "./api";
import { Icon, ToastProvider } from "./components/ui";
import { CustomerDetail } from "./pages/CustomerDetail";
import { Customers } from "./pages/Customers";
import { Dashboard } from "./pages/Dashboard";
import { Equipment } from "./pages/Equipment";
import { PackageEditor } from "./pages/PackageEditor";
import { Packages } from "./pages/Packages";
import { NewQuote } from "./pages/NewQuote";
import { QuoteBuilder } from "./pages/QuoteBuilder";
import { Quotes } from "./pages/Quotes";
import { QuoteView } from "./pages/QuoteView";
import { SettingsPage } from "./pages/Settings";
import "./styles.css";

const NAV = [
  { to: "/", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/quotes", label: "Quotations", icon: "quote" },
  { to: "/customers", label: "Customers", icon: "customers" },
  { to: "/equipment", label: "Equipment", icon: "equipment" },
  { to: "/packages", label: "CCTV Packages", icon: "package" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

function Shell() {
  const [me, setMe] = useState<{ email: string; environment: string; via: string } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { api.get<typeof me>("/me").then(setMe).catch((e) => setAuthError(e.message)); }, []);
  useEffect(() => setOpen(false), [location.pathname]);

  if (authError) {
    return <div className="content"><div className="notice error"><strong>Unable to sign in.</strong> {authError}</div></div>;
  }

  return (
    <div className="app">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">AS</div>
          <div><div className="brand-name">ASTO Office</div><div className="brand-sub">ASTO SECURITY</div></div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} />{n.label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {me?.email}
          {me && me.environment !== "production" && <div><span className="env-dev">{me.environment} · {me.via}</span></div>}
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button onClick={() => setOpen(!open)} aria-label="Menu"><Icon name="menu" /></button>
          <strong>ASTO Office</strong>
        </div>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "quotes", element: <Quotes /> },
      { path: "quotes/new", element: <NewQuote /> },
      { path: "quotes/:id", element: <QuoteView /> },
      { path: "quotes/:id/edit", element: <QuoteBuilder /> },
      { path: "customers", element: <Customers /> },
      { path: "customers/:id", element: <CustomerDetail /> },
      { path: "equipment", element: <Equipment /> },
      { path: "packages", element: <Packages /> },
      { path: "packages/:id", element: <PackageEditor /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <div className="notice info">Page not found.</div> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
);
