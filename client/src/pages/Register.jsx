import React, { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  UserRound,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  GitCommit,
  Users,
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
    name: "name",
    type: "text",
    label: "Full Name",
    placeholder: "John Doe",
    autoComplete: "name",
    icon: UserRound,
  },
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
    autoComplete: "new-password",
    helperText: "At least 8 characters. A longer passphrase is even better.",
    icon: Lock,
    hasToggle: true,
  },
  {
    name: "confirmPassword",
    type: "password",
    label: "Confirm Password",
    placeholder: "••••••••",
    autoComplete: "new-password",
    icon: Lock,
    hasToggle: true,
  },
];

const FIELD_ORDER = FIELDS.map((f) => f.name);

const FEATURE_POINTS = [
  { icon: Code2, label: "Repository intelligence" },
  { icon: GitCommit, label: "Code and commit analytics" },
  { icon: Sparkles, label: "AI-powered insights" },
];

/* -------------------------------------------------------------------------- */
/* Validation, password strength, and API error mapping (pure helpers)        */
/* -------------------------------------------------------------------------- */

const MIN_PASSWORD_LENGTH = 8; // keep in sync with the backend policy
const MAX_NAME_LENGTH = 100;

// Practical format check. It does not prove the mailbox exists.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateName(raw) {
  const name = raw.trim();
  if (!name) return "Please enter your full name.";
  if (name.length > MAX_NAME_LENGTH) {
    return `Full name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  return "";
}

function validateEmail(raw) {
  const email = raw.trim();
  if (!email) return "Please enter your email address.";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return "Please enter a valid email address.";
  }
  return "";
}

function validatePassword(password) {
  // Never trimmed or normalised.
  if (!password) return "Please create a password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return "";
}

function validateConfirm(password, confirm) {
  if (!confirm) return "Please confirm your password.";
  if (confirm !== password) return "Passwords do not match.";
  return "";
}

function validateAll(form) {
  return {
    name: validateName(form.name),
    email: validateEmail(form.email),
    password: validatePassword(form.password),
    confirmPassword: validateConfirm(form.password, form.confirmPassword),
  };
}

const COMMON_PASSWORDS = [
  "password",
  "password1",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "qwertyuiop",
  "iloveyou",
  "11111111",
];

// Advisory only: the server must enforce its own password policy.
// Returns null for an empty password, otherwise { level: 1 | 2 | 3, label }.
function getPasswordStrength(password) {
  if (!password) return null;

  const weak = { level: 1, label: "Weak" };

  if (password.length < MIN_PASSWORD_LENGTH) return weak;
  if (/^(.)\1+$/.test(password)) return weak;
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) return weak;

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password)
  ).length;

  let score = 1; // meets the minimum length
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (classes >= 3) score += 1;

  if (score <= 1) return weak;
  if (score === 2) return { level: 2, label: "Fair" };
  return { level: 3, label: "Strong" };
}

const STRENGTH_HINTS = {
  1: "Use at least 8 characters. A longer phrase works best.",
  2: "Good start. A few more characters or a mix of character types will make it stronger.",
  3: "Nice. That's a strong password.",
};

const MESSAGES = {
  network:
    "Unable to connect to the server. Please check your connection and try again.",
  server: "Something went wrong. Please try again in a moment.",
  rateLimited: "Too many attempts. Please wait a moment before trying again.",
  duplicate: "An account with this email may already exist. Try logging in.",
  validation: "Please check your details and try again.",
  generic:
    "We couldn't create your account. Please check your details and try again.",
};

const DUPLICATE_PATTERN =
  /e11000|duplicate|already\s+(exists?|registered|in use|taken)|user\s+exists|email\s+(exists|is taken|in use)/i;

// Backend messages are only shown if they look like plain user-facing text.
// Anything resembling a stack trace, DB error, token, or path is dropped.
const UNSAFE_MESSAGE_PATTERN =
  /mongo|e11000|stack|jwt|token|secret|econn|enotfound|exception|error:|undefined|null|[{}[\]\\/<>]|\bat\s.+:\d+/i;

function safeBackendMessage(raw) {
  if (typeof raw !== "string") return "";
  const text = raw.trim();
  if (!text || text.length > 140 || /[\r\n]/.test(text)) return "";
  if (UNSAFE_MESSAGE_PATTERN.test(text)) return "";
  return text;
}

// Maps any failure to { text, showLogin }. Never returns raw exception text.
function getRegisterError(err) {
  const response = err?.response;

  if (!response) return { text: MESSAGES.network, showLogin: false };

  const { status, data } = response;
  const code = typeof data?.code === "string" ? data.code.toLowerCase() : "";
  const rawMessage =
    typeof data?.message === "string"
      ? data.message
      : typeof data?.error === "string"
      ? data.error
      : "";

  if (status === 429) return { text: MESSAGES.rateLimited, showLogin: false };

  // Prefer structured signals (status / code); the message pattern is only a
  // fallback for backends that return a plain string.
  const isDuplicate =
    status === 409 ||
    data?.code === 11000 ||
    data?.error?.code === 11000 ||
    /duplicate|exists|already|taken/.test(code) ||
    DUPLICATE_PATTERN.test(rawMessage);

  if (isDuplicate) return { text: MESSAGES.duplicate, showLogin: true };

  if (status >= 500) return { text: MESSAGES.server, showLogin: false };

  if (status === 400 || status === 422) {
    return {
      text: safeBackendMessage(rawMessage) || MESSAGES.validation,
      showLogin: false,
    };
  }

  return { text: MESSAGES.generic, showLogin: false };
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
            Already have an account?
          </span>
          <Link
            to="/login"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 font-medium text-slate-200 transition-colors hover:bg-slate-900 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 motion-reduce:transition-none"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}

function StatRow({ label, value, tone = "default" }) {
  const toneClasses =
    tone === "good"
      ? "text-emerald-400"
      : tone === "accent"
      ? "text-sky-400"
      : "text-slate-200";

  return (
    <div className="flex items-center justify-between border-b border-slate-800/70 py-2 last:border-0">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className={`text-[11px] font-medium ${toneClasses}`}>{value}</span>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg shadow-black/20">
      {/* window chrome */}
      <div className="flex items-center gap-1.5 border-b border-slate-800 px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-slate-700" />
        <span className="h-2 w-2 rounded-full bg-slate-700" />
        <span className="h-2 w-2 rounded-full bg-slate-700" />
        <span className="ml-2 text-[11px] text-slate-500">repoiq / overview</span>
      </div>

      <div className="px-4 py-3.5">
        <div className="mb-3 flex items-center gap-2">
          <GithubMark size={14} className="text-slate-400" />
          <span className="text-xs font-medium text-slate-200">acme/payments-api</span>
          <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-500">
            <GitBranch size={11} />
            main
          </span>
        </div>

        <StatRow label="Commits (30d)" value="214" />
        <StatRow label="Contributors" value="12" />
        <StatRow label="Code health" value="Good" tone="good" />
        <StatRow label="Open PRs" value="6" />

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-sky-500/15 bg-sky-500/5 p-2.5">
          <Sparkles size={13} className="mt-0.5 shrink-0 text-sky-400" />
          <p className="text-[11px] leading-relaxed text-slate-400">
            <span className="font-medium text-slate-300">AI insight:</span>{" "}
            Auth module complexity rose 18% this sprint.
          </p>
        </div>
      </div>
    </div>
  );
}

function HeroVisual() {
  const nodes = [
    { icon: GithubMark, label: "GitHub repository" },
    { icon: Code2, label: "Code" },
    { icon: GitCommit, label: "Commits" },
    { icon: Users, label: "Contributors" },
    { icon: Sparkles, label: "AI insights" },
  ];

  return (
    <div className="hidden flex-col items-center gap-0 sm:flex" aria-hidden="true">
      {nodes.map(({ icon: Icon, label }, i) => (
        <React.Fragment key={label}>
          <div className="flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5">
            <Icon size={13} className="text-sky-400" />
            <span className="text-[11px] text-slate-400">{label}</span>
          </div>
          {i < nodes.length - 1 && <div className="h-4 w-px bg-slate-800" />}
        </React.Fragment>
      ))}
    </div>
  );
}

const STRENGTH_STYLES = {
  1: { bar: "bg-rose-400", text: "text-rose-300" },
  2: { bar: "bg-amber-400", text: "text-amber-300" },
  3: { bar: "bg-emerald-400", text: "text-emerald-300" },
};

function PasswordStrength({ password, id }) {
  const strength = getPasswordStrength(password);
  if (!strength) return null;

  const styles = STRENGTH_STYLES[strength.level];

  return (
    <div id={id} className="space-y-1.5 pl-0.5">
      {/* Decorative bar; the text below carries the meaning for screen readers */}
      <div className="flex gap-1.5" aria-hidden="true">
        {[1, 2, 3].map((segment) => (
          <span
            key={segment}
            className={`h-1 flex-1 rounded-full transition-colors duration-200 motion-reduce:transition-none ${
              segment <= strength.level ? styles.bar : "bg-slate-800"
            }`}
          />
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        <span aria-live="polite" className={`font-medium ${styles.text}`}>
          Password strength: {strength.label}.
        </span>{" "}
        {STRENGTH_HINTS[strength.level]}
      </p>
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
  extraDescribedBy,
  children,
}) {
  const { name, type, label, placeholder, autoComplete, helperText, icon: Icon, hasToggle, inputMode } =
    field;

  const inputType = hasToggle ? (showValue ? "text" : "password") : type;
  const errorId = `${name}-error`;
  const helperId = `${name}-help`;
  // Helper text is hidden while an error is shown so the same point isn't made twice
  const showHelper = helperText && !error;

  const describedBy =
    [error ? errorId : null, showHelper ? helperId : null, extraDescribedBy]
      .filter(Boolean)
      .join(" ") || undefined;

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
          spellCheck={name === "email" || hasToggle ? false : undefined}
          // readOnly (not disabled) while submitting so focus isn't dropped
          readOnly={disabled}
          aria-required="true"
          aria-invalid={error ? "true" : "false"}
          aria-describedby={describedBy}
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
      {showHelper && (
        <p id={helperId} className="pl-0.5 text-[11px] leading-relaxed text-slate-500">
          {helperText}
        </p>
      )}
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

const EMPTY_ERRORS = { name: "", email: "", password: "", confirmPassword: "" };

export default function Register() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPasswords, setShowPasswords] = useState({
    password: false,
    confirmPassword: false,
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null); // null | "dashboard" | "login"
  // Server-side failures (banner); field validation lives in fieldErrors
  const [error, setError] = useState(null); // { text, showLogin } | null
  const [fieldErrors, setFieldErrors] = useState(EMPTY_ERRORS);

  const inputRefs = {
    name: useRef(null),
    email: useRef(null),
    password: useRef(null),
    confirmPassword: useRef(null),
  };
  // Synchronous guard against double submits (state updates are async)
  const submittingRef = useRef(false);
  const attemptedRef = useRef(false);
  const redirectTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(redirectTimerRef.current), []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    const next = { ...form, [name]: value };

    setForm(next);
    if (error) setError(null);

    setFieldErrors((prev) => {
      const updated = { ...prev, [name]: "" };

      // Changing the password re-checks the confirmation, so a stale mismatch
      // error clears (or appears) as soon as the two values change.
      if (name === "password" && (prev.confirmPassword || (attemptedRef.current && next.confirmPassword))) {
        updated.confirmPassword = validateConfirm(next.password, next.confirmPassword);
      }
      return updated;
    });
  };

  const toggleVisibility = (name) =>
    setShowPasswords((prev) => ({ ...prev, [name]: !prev[name] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current || success) return;

    attemptedRef.current = true;
    setError(null);

    const nextErrors = validateAll(form);
    setFieldErrors(nextErrors);

    const firstInvalid = FIELD_ORDER.find((key) => nextErrors[key]);
    if (firstInvalid) {
      inputRefs[firstInvalid].current?.focus();
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      const response = await API.post("/auth/register", {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password, // sent exactly as typed
      });

      // Reaching here means the backend confirmed the account was created.
      const token = response?.data?.token;
      const user = response?.data?.user;

      let signedIn = false;
      if (typeof token === "string" && token) {
        try {
          localStorage.setItem("token", token);
          if (user) {
            localStorage.setItem("user", JSON.stringify(user));
          } else {
            localStorage.removeItem("user");
          }
          signedIn = true;
        } catch {
          try {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
          } catch {
            /* ignore */
          }
        }
      }

      // Backend authenticated us -> dashboard. Otherwise -> sign in.
      const destination = signedIn ? "dashboard" : "login";
      setSuccess(destination);
      redirectTimerRef.current = setTimeout(
        () => navigate(destination === "dashboard" ? "/dashboard" : "/login"),
        900
      );
    } catch (err) {
      // No logging of the error object: err.config.data contains the password.
      setError(getRegisterError(err));
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const locked = loading || !!success;

  return (
    <div className="min-h-screen min-h-[100dvh] w-full overflow-x-hidden bg-[#030712] font-sans antialiased">
      <SiteHeader />

      <main className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-8 px-4 py-8 sm:gap-12 sm:px-6 sm:py-12 lg:grid-cols-2 lg:gap-10 lg:px-8 lg:py-20">
        {/* ---------------------------------------------------------------- */}
        {/* Hero column                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section className="order-1 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
          <p className="mb-4 hidden text-xs font-medium text-sky-400 sm:block">
            Understand, analyze, and improve your repositories with AI.
          </p>

          <h1 className="text-[28px] font-bold leading-[1.15] tracking-tight text-white min-[400px]:text-[32px] sm:text-[42px] sm:leading-[1.1] lg:text-[52px]">
            Start understanding
            <br />
            your <span className="text-sky-400">codebase.</span>
          </h1>

          {/* Supporting content is hidden on phones so the form stays near the top */}
          <p className="mt-5 hidden max-w-md text-[15px] leading-relaxed text-slate-400 sm:block">
            RepoIQ AI helps you analyze your GitHub repositories, understand
            commits, explore contributors, and discover AI-powered insights about
            what is really happening inside your codebase.
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

          <div className="mt-10 hidden lg:flex lg:items-start lg:gap-8">
            <DashboardPreview />
            <HeroVisual />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Registration card                                               */}
        {/* ---------------------------------------------------------------- */}
        <section className="order-2 flex justify-center lg:justify-end">
          <div className="w-full min-w-0 max-w-[440px] rounded-[20px] border border-slate-800 bg-slate-900/50 p-5 shadow-2xl shadow-black/40 backdrop-blur-sm sm:p-8">
            <div className="mb-5 sm:mb-6">
              <h2 className="text-xl font-semibold text-white">Create your RepoIQ account</h2>
              <p className="mt-1.5 text-sm text-slate-400">
                Start analyzing your repositories with AI.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300"
              >
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-400" aria-hidden="true" />
                <span className="leading-relaxed">
                  {error.text}
                  {error.showLogin && (
                    <>
                      {" "}
                      <Link
                        to="/login"
                        className="font-medium text-sky-400 underline-offset-2 hover:text-sky-300 hover:underline focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-sky-500/50"
                      >
                        Go to sign in
                      </Link>
                    </>
                  )}
                </span>
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
                    disabled={locked}
                    showValue={field.hasToggle ? showPasswords[field.name] : undefined}
                    onToggleShow={() => toggleVisibility(field.name)}
                    error={fieldErrors[field.name]}
                    inputRef={inputRefs[field.name]}
                    extraDescribedBy={
                      isPassword && form.password ? "password-strength" : undefined
                    }
                  >
                    {isPassword && (
                      <PasswordStrength password={form.password} id="password-strength" />
                    )}
                  </FormField>
                );
              })}

              <button
                type="submit"
                disabled={locked}
                className={`group mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium text-white transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed motion-reduce:transition-none ${
                  success
                    ? "bg-emerald-600"
                    : "bg-sky-600 hover:bg-sky-500 disabled:opacity-70"
                }`}
              >
                {success ? (
                  <>
                    <CheckCircle2 size={17} aria-hidden="true" />
                    <span>Account created successfully!</span>
                  </>
                ) : loading ? (
                  <>
                    <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                    <span role="status">Creating account...</span>
                  </>
                ) : (
                  <>
                    <span>Create account</span>
                    <ArrowRight
                      size={16}
                      aria-hidden="true"
                      className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                    />
                  </>
                )}
              </button>

              {success && (
                <p role="status" className="text-center text-xs text-emerald-300">
                  {success === "dashboard"
                    ? "Taking you to your dashboard..."
                    : "Redirecting you to sign in..."}
                </p>
              )}
            </form>

            <div className="mt-6 border-t border-slate-800 pt-5 text-center">
              <p className="text-xs text-slate-400">
                Already have an account?{" "}
                <Link
                  to="/login"
                  className="inline-block py-2 font-medium text-sky-400 hover:text-sky-300 focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-sky-500/50"
                >
                  Sign in
                </Link>
              </p>
              <p className="mt-1 hidden text-[11px] text-slate-600 sm:block">
                GitHub &bull; Code Analytics &bull; AI Insights
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}