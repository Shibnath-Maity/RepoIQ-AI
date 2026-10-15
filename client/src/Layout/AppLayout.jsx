import React, { useState, useEffect, useCallback, useRef } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/sidebar";

function AppLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Refs let us move focus into the drawer when it opens and back to the
  // hamburger button when it closes, without pulling in a focus-trap library.
  const menuButtonRef = useRef(null);
  const sidebarRef = useRef(null);

  const openSidebar = useCallback(() => setIsSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setIsSidebarOpen(false), []);

  // Close on Escape key
  useEffect(() => {
    if (!isSidebarOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") closeSidebar();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSidebarOpen, closeSidebar]);

  // Lock body scroll when the mobile/tablet drawer is open
  useEffect(() => {
    if (isSidebarOpen) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previousOverflow;
      };
    }
  }, [isSidebarOpen]);

  // Move focus into the drawer on open, and back to the trigger on close, so
  // keyboard users aren't dropped behind the overlay or stranded off-screen.
  useEffect(() => {
    if (isSidebarOpen) {
      sidebarRef.current?.querySelector("a, button")?.focus();
    } else {
      menuButtonRef.current?.focus();
    }
  }, [isSidebarOpen]);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800 antialiased transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      {/* Mobile / Tablet Overlay (below lg, where the sidebar is a drawer) */}
      <div
        onClick={closeSidebar}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-slate-900/40 transition-opacity duration-200 dark:bg-black/60 lg:hidden ${
          isSidebarOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      />

      {/* Sidebar */}
      {/* Below lg: fixed off-canvas drawer, capped at 85% of the viewport so
          it can never overflow very narrow phones. At lg+: persistent, fixed
          w-72 column that always sits on screen. */}
      <aside
        id="app-sidebar"
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[300px]
          transform border-r border-slate-200/80 bg-white
          transition-transform duration-200 ease-in-out
          dark:border-slate-800 dark:bg-slate-900
          ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
          lg:w-72 lg:max-w-none lg:translate-x-0`}
      >
        <Sidebar onCloseMobile={closeSidebar} />
      </aside>

      {/* Main Wrapper */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-72">
        {/* Mobile / Tablet Header (hidden at lg+, where the sidebar is always visible) */}
        <header
          className="sticky top-0 z-30 flex h-14 items-center gap-3
            border-b border-slate-200/80 bg-white/80 px-3
            backdrop-blur-md transition-colors duration-300
            dark:border-slate-800 dark:bg-slate-900/80
            sm:h-16 sm:px-4 md:px-6 lg:hidden"
        >
          <button
            type="button"
            ref={menuButtonRef}
            onClick={openSidebar}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center
              rounded-lg text-slate-600 transition-colors
              hover:bg-slate-100 hover:text-slate-900
              focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400
              dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label="Open sidebar"
            aria-expanded={isSidebarOpen}
            aria-controls="app-sidebar"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            </svg>
          </button>

          <span className="truncate font-semibold text-slate-900 dark:text-white">
            Dashboard
          </span>
        </header>

        {/* Main Content */}
        <main className="min-w-0 flex-1 overflow-x-hidden bg-slate-50 transition-colors duration-300 dark:bg-slate-950">
          <div className="mx-auto max-w-screen-2xl p-3 sm:p-4 md:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default AppLayout;