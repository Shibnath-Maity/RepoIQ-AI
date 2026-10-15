import React, { useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  AlertCircle,
  Loader2,
  GitCommit,
  Code2,
  Sparkles,
  GitBranch,
} from "lucide-react";
import API from "../services/api";
import logo from "../assets/logo.png";

/* lucide-react no longer ships brand/logo icons (Github, Twitter, etc.), so
   the GitHub mark is a small inline SVG instead of a package import. */
function GithubMark({ size = 14, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.04 11.04 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.43-2.69 5.41-5.26 5.69.42.36.78 1.07.78 2.16 0 1.56-.01 2.82-.01 3.2 0 .3.2.66.79.55A10.51 10.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Static content                                                             */
/* -------------------------------------------------------------------------- */

const FIELDS = [
  {
    name: "email",
    type: "email",
    label: "Email Address",
    placeholder: "name@company.com",
    autoComplete: "email",
    icon: Mail,
    inputMode: "email",
  },
  {
    name: "password",
    type: "password",
    label: "Password",
    placeholder: "••••••••",
    autoComplete: "current-password",
    icon: Lock,
    hasToggle: true,
  },
];

const FEATURE_POINTS = [
  { icon: Code2, label: "Repository intelligence" },
  { icon: GitCommit, label: "Code & commit analytics" },
  { icon: Sparkles, label: "AI-powered insights" },
];

/* -------------------------------------------------------------------------- */
/* Validation + error mapping (pure helpers)                                  */
/* -------------------------------------------------------------------------- */

// Practical format check: something@something.tld, no spaces, no provider
// restrictions. Deliberately not RFC-exhaustive; the server remains the
// source of truth for whether an address is actually registered.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateEmail(rawEmail) {
  const email = rawEmail.trim();
  if (!email) return "Please enter your email address.";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return "Please enter a valid email address.";
  }
  return "";
}

function validatePassword(password) {
  // Password is never trimmed or modified. Only emptiness is checked so that
  // existing users with any stored password can still sign in.
  if (!password) return "Please enter your password.";
  return "";
}

const MESSAGES = {
  invalidCredentials:
    "Invalid email or password. Please check your credentials and try again.",
  network:
    "Unable to connect to the server. Please check your connection and try again.",
  server: "Something went wrong. Please try again in a moment.",
  rateLimited: "Too many sign-in attempts. Please wait a moment and try again.",
  generic: "We couldn't sign you in. Please check your details and try again.",
  noToken: "We couldn't complete your sign-in. Please try again in a moment.",
  storage:
    "Your browser blocked saving the session. Please check your browser's storage settings and try again.",
};

// Maps any failure to a fixed, user-safe string. Raw backend messages, stack
// traces, and exception text are never shown.
function getLoginErrorMessage(err) {
  const response = err?.response;

  if (!response) {
    // No HTTP response at all: offline, DNS failure, CORS, timeout, etc.
    return MESSAGES.network;
  }

  const status = response.status;

  if (status === 401 || status === 403) return MESSAGES.invalidCredentials;

  if (status === 429) {
    const retryAfter = Number.parseInt(response.headers?.["retry-after"], 10);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      const wait =
        retryAfter >= 60
          ? `${Math.ceil(retryAfter / 60)} minute${retryAfter > 60 ? "s" : ""}`
          : `${retryAfter} second${retryAfter === 1 ? "" : "s"}`;
      return `Too many sign-in attempts. Please wait ${wait} and try again.`;
    }
    return MESSAGES.rateLimited;
  }

  if (status >= 500) return MESSAGES.server;

  return MESSAGES.generic;
}

/* -------------------------------------------------------------------------- */
/* Small presentational pieces                                                */
/* -------------------------------------------------------------------------- */

function Logo({ className = "" }) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {imgFailed ? (
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-sky-400 shrink-0">
          <GitBranch size={17} className="stroke-[2.2]" />
        </div>
      ) : (
        <img
          src={logo}
          alt=""
          onError={() => setImgFailed(true)}
          className="h-8 w-8 shrink-0 object-contain transition-transform duration-200 hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100"
        />
      )}
      <span className="text-[15px] font-semibold tracking-tight text-white">
        RepoIQ <span className="text-sky-400">AI</span>
      </span>
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="w-full border-b border-slate-800/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
        <Logo />
        <div className="flex items-center gap-2 text-xs sm:text-sm">
          <span className="hidden text-slate-500 sm:inline">
            Don't have an account?
          </span>
          <Link
            to="/register"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 font-medium text-slate-200 transition-colors hover:bg-slate-900 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 motion-reduce:transition-none"
          >
            Create account
          </Link>
        </div>
      </div>
    </header>
  );
}

function HeroVisual() {
  const nodes = [
    { icon: GithubMark, label: "Repository" },
    { icon: Code2, label: "Code" },
    { icon: GitCommit, label: "Commits" },
    { icon: Sparkles, label: "AI insights" },
  ];

  return (
    <div className="hidden flex-col gap-0 sm:flex" aria-hidden="true">
      {nodes.map(({ icon: Icon, label }, i) => (
        <React.Fragment key={label}>
          <div className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5">
            <Icon size={13} className="text-sky-400" />
            <span className="text-[11px] text-slate-400">{label}</span>
          </div>
          {i < nodes.length - 1 && <div className="h-4 w-px bg-slate-800 ml-[18px]" />}
        </React.Fragment>
      ))}
    </div>
  );
}

function FormField({
  field,
  value,
  onChange,
  disabled,
  showValue,
  onToggleShow,
  error,
  inputRef,
}) {
  const { name, type, label, placeholder, autoComplete, icon: Icon, hasToggle, inputMode } = field;

  const inputType = hasToggle ? (showValue ? "text" : "password") : type;
  const errorId = `${name}-error`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-xs font-medium text-slate-300">
        {label}
      </label>
      <div className="relative flex items-center">
        <Icon size={16} className="pointer-events-none absolute left-3.5 text-slate-500" />
        <input
          ref={inputRef}
          id={name}
          type={inputType}
          name={name}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          inputMode={inputMode}
          autoCapitalize={name === "email" ? "none" : undefined}
          spellCheck={name === "email" ? false : undefined}
          // readOnly (not disabled) while submitting so focus isn't dropped
          readOnly={disabled}
          aria-required="true"
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? errorId : undefined}
          className={`h-12 w-full min-w-0 rounded-lg border bg-slate-950/70 pl-10 ${
            hasToggle ? "pr-12" : "pr-3.5"
          } text-base text-slate-100 outline-none transition-colors duration-150 placeholder:text-slate-600 focus:ring-2 read-only:cursor-not-allowed read-only:opacity-60 motion-reduce:transition-none sm:text-sm ${
            error
              ? "border-rose-500/60 focus:border-rose-500/70 focus:ring-rose-500/20"
              : "border-slate-800 focus:border-sky-500/70 focus:ring-sky-500/20"
          }`}
        />
        {hasToggle && (
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-1 flex h-11 w-11 items-center justify-center rounded-md text-slate-400 transition-colors hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 motion-reduce:transition-none"
            aria-label={showValue ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={!!showValue}
          >
            {showValue ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-xs leading-relaxed text-rose-300">
          <AlertCircle size={13} className="mt-0.5 shrink-0 text-rose-400" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function Login() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  // Server / authentication failures (shown in the alert banner)
  const [error, setError] = useState("");
  // Per-field validation failures (shown beside each field)
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });

  const inputRefs = { email: useRef(null), password: useRef(null) };
  // Synchronous guard: state updates are async, so rapid double-clicks or
  // Enter presses could otherwise slip a second request through.
  const submittingRef = useRef(false);

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({ ...prev, [name]: value }));

    // Clear only this field's validation error, plus any stale server error
    setFieldErrors((prev) => (prev[name] ? { ...prev, [name]: "" } : prev));
    if (error) setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;

    setError("");

    const email = form.email.trim();
    const password = form.password; // intentionally untouched

    const nextErrors = {
      email: validateEmail(form.email),
      password: validatePassword(password),
    };
    setFieldErrors(nextErrors);

    if (nextErrors.email || nextErrors.password) {
      const firstInvalid = nextErrors.email ? "email" : "password";
      inputRefs[firstInvalid].current?.focus();
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      const response = await API.post("/auth/login", {
        email,
        password,
      });

      const token = response?.data?.token;
      const user = response?.data?.user;

      if (!token || typeof token !== "string") {
        setError(MESSAGES.noToken);
        return;
      }

      try {
        localStorage.setItem("token", token);

        if (user) {
          localStorage.setItem("user", JSON.stringify(user));
        } else {
          // Don't leave a previous account's profile next to a new token
          localStorage.removeItem("user");
        }
      } catch {
        // e.g. storage disabled / quota exceeded; never leave a half-saved session
        try {
          localStorage.removeItem("token");
          localStorage.removeItem("user");
        } catch {
          /* ignore */
        }
        setError(MESSAGES.storage);
        return;
      }

      navigate("/dashboard");
    } catch (err) {
      // Deliberately no logging of the error object: it can carry the request
      // body (including the password) in err.config.data.
      setError(getLoginErrorMessage(err));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] w-full overflow-x-hidden bg-[#030712] font-sans antialiased">
      <SiteHeader />

      <main className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-8 px-4 py-8 sm:gap-12 sm:px-6 sm:py-12 lg:grid-cols-2 lg:gap-10 lg:px-8 lg:py-24">
        {/* ---------------------------------------------------------------- */}
        {/* Hero column                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section className="order-1 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
          <h1 className="text-[28px] font-bold leading-[1.15] tracking-tight text-white min-[400px]:text-[32px] sm:text-[42px] sm:leading-[1.1] lg:text-[48px]">
            Welcome back.
            <br />
            Your codebase is <span className="text-sky-400">waiting.</span>
          </h1>

          {/* Supporting copy is hidden on phones so the form stays above the fold */}
          <p className="mt-5 hidden max-w-md text-[15px] leading-relaxed text-slate-400 sm:block">
            Continue exploring your repositories, code changes, contributors, and
            AI-powered insights with RepoIQ.
          </p>

          <ul className="mt-6 hidden space-y-2.5 sm:block">
            {FEATURE_POINTS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5 text-sm text-slate-300">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/10 text-sky-400">
                  <Icon size={12} />
                </span>
                {label}
              </li>
            ))}
          </ul>

          <div className="mt-10 hidden lg:block">
            <HeroVisual />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Login card                                                      */}
        {/* ---------------------------------------------------------------- */}
        <section className="order-2 flex justify-center lg:justify-end">
          <div className="w-full min-w-0 max-w-[440px] rounded-[20px] border border-slate-800 bg-slate-900/50 p-5 shadow-2xl shadow-black/40 backdrop-blur-sm sm:p-8">
            <div className="mb-5 sm:mb-6">
              <h2 className="text-xl font-semibold text-white">Sign in to RepoIQ</h2>
              <p className="mt-1.5 text-sm text-slate-400">
                Access your repository intelligence dashboard.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300"
              >
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-400" aria-hidden="true" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate aria-busy={loading} className="space-y-4">
              {FIELDS.map((field) => {
                const isPassword = field.name === "password";

                return (
                  <FormField
                    key={field.name}
                    field={field}
                    value={form[field.name]}
                    onChange={handleChange}
                    disabled={loading}
                    showValue={isPassword ? showPassword : undefined}
                    onToggleShow={() => setShowPassword((prev) => !prev)}
                    error={fieldErrors[field.name]}
                    inputRef={inputRefs[field.name]}
                  />
                );
              })}

              <button
                type="submit"
                disabled={loading}
                className="group mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-sky-600 text-sm font-medium text-white transition-colors duration-150 hover:bg-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none"
              >
                {loading ? (
                  <>
                    <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                    <span role="status">Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign in</span>
                    <ArrowRight
                      size={16}
                      aria-hidden="true"
                      className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                    />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 border-t border-slate-800 pt-5 text-center">
              <p className="text-xs text-slate-400">
                New to RepoIQ?{" "}
                <Link
                  to="/register"
                  className="inline-block py-2 font-medium text-sky-400 hover:text-sky-300 focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-sky-500/50"
                >
                  Create your account
                </Link>
              </p>
              <p className="mt-1 text-[11px] text-slate-600">
                Repository intelligence for modern developers
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}