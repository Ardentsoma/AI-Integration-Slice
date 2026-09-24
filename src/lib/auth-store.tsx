"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import {
  KEYS,
  loadFormValue,
  saveFormValue,
  clearFormValue,
} from "@/lib/form-storage";

/**
 * Central client-side store for the auth flows, backed by React Context +
 * useReducer (no external dependency).
 *
 * Owned here (single source of truth, shared across every form):
 * - which modal is open over the sign-in screen,
 * - the pending verification email,
 * - the non-sensitive form values (email / full name) the forms render.
 *
 * Every write is mirrored to sessionStorage by the actions below, so the
 * values survive reloads and navigation — and they all live in one place
 * instead of scattered useState calls. Transient per-submission state (loading
 * flags, touched/error maps) intentionally stays local to each form.
 */
export type AuthModal = "forgot" | "verify" | "reset";

export interface AuthStoreActions {
  openModal: (modal: AuthModal) => void;
  closeModal: () => void;
  setPendingEmail: (email: string) => void;
  clearPendingEmail: () => void;
  setSigninEmail: (email: string) => void;
  setSignupFullName: (name: string) => void;
  setSignupEmail: (email: string) => void;
  setForgotEmail: (email: string) => void;
  clearSignup: () => void;
}

interface AuthState {
  modal: AuthModal | null;
  pendingEmail: string;
  signinEmail: string;
  signupFullName: string;
  signupEmail: string;
  forgotEmail: string;
}

interface AuthStoreValue {
  state: AuthState;
  actions: AuthStoreActions;
}

const PENDING_EMAIL_KEY = "scope_pending_email";

type AuthAction =
  | { type: "OPEN_MODAL"; modal: AuthModal }
  | { type: "CLOSE_MODAL" }
  | { type: "SET_PENDING_EMAIL"; email: string }
  | { type: "CLEAR_PENDING_EMAIL" }
  | { type: "SET_SIGNIN_EMAIL"; email: string }
  | { type: "SET_SIGNUP_FULL_NAME"; name: string }
  | { type: "SET_SIGNUP_EMAIL"; email: string }
  | { type: "SET_FORGOT_EMAIL"; email: string }
  | { type: "CLEAR_SIGNUP" };

const initialPendingEmail = (): string =>
  typeof window !== "undefined"
    ? (sessionStorage.getItem(PENDING_EMAIL_KEY) ?? "")
    : "";
const initialSigninEmail = (): string => loadFormValue(KEYS.signinEmail) ?? "";
const initialSignupFullName = (): string =>
  loadFormValue(KEYS.signupFullName) ?? "";
const initialSignupEmail = (): string => loadFormValue(KEYS.signupEmail) ?? "";
const initialForgotEmail = (): string =>
  loadFormValue(KEYS.forgotEmail) ?? initialSigninEmail();

function getInitialState(): AuthState {
  return {
    modal: null,
    pendingEmail: initialPendingEmail(),
    signinEmail: initialSigninEmail(),
    signupFullName: initialSignupFullName(),
    signupEmail: initialSignupEmail(),
    forgotEmail: initialForgotEmail(),
  };
}

function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "OPEN_MODAL":
      return { ...state, modal: action.modal };
    case "CLOSE_MODAL":
      return { ...state, modal: null };
    case "SET_PENDING_EMAIL":
      return { ...state, pendingEmail: action.email };
    case "CLEAR_PENDING_EMAIL":
      return { ...state, pendingEmail: "" };
    case "SET_SIGNIN_EMAIL":
      return { ...state, signinEmail: action.email };
    case "SET_SIGNUP_FULL_NAME":
      return { ...state, signupFullName: action.name };
    case "SET_SIGNUP_EMAIL":
      return { ...state, signupEmail: action.email };
    case "SET_FORGOT_EMAIL":
      return { ...state, forgotEmail: action.email };
    case "CLEAR_SIGNUP":
      return { ...state, signupFullName: "", signupEmail: "" };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState);

  // Persist writes to sessionStorage alongside each state change. The reducer
  // itself stays pure; the side effects live in this wrapper.
  const persistAndDispatch = useCallback(
    (action: AuthAction) => {
      switch (action.type) {
        case "SET_PENDING_EMAIL":
          saveFormValue(PENDING_EMAIL_KEY, action.email);
          break;
        case "CLEAR_PENDING_EMAIL":
          clearFormValue(PENDING_EMAIL_KEY);
          break;
        case "SET_SIGNIN_EMAIL":
          if (action.email) saveFormValue(KEYS.signinEmail, action.email);
          else clearFormValue(KEYS.signinEmail);
          break;
        case "SET_SIGNUP_FULL_NAME":
          if (action.name) saveFormValue(KEYS.signupFullName, action.name);
          else clearFormValue(KEYS.signupFullName);
          break;
        case "SET_SIGNUP_EMAIL":
          if (action.email) saveFormValue(KEYS.signupEmail, action.email);
          else clearFormValue(KEYS.signupEmail);
          break;
        case "SET_FORGOT_EMAIL":
          if (action.email) saveFormValue(KEYS.forgotEmail, action.email);
          else clearFormValue(KEYS.forgotEmail);
          break;
        case "CLEAR_SIGNUP":
          clearFormValue(KEYS.signupFullName);
          clearFormValue(KEYS.signupEmail);
          break;
      }
      dispatch(action);
    },
    [dispatch]
  );

  const actions = useMemo(
    (): AuthStoreActions => ({
      openModal: (modal) =>
        persistAndDispatch({ type: "OPEN_MODAL", modal }),
      closeModal: () => persistAndDispatch({ type: "CLOSE_MODAL" }),
      setPendingEmail: (email) =>
        persistAndDispatch({ type: "SET_PENDING_EMAIL", email }),
      clearPendingEmail: () =>
        persistAndDispatch({ type: "CLEAR_PENDING_EMAIL" }),
      setSigninEmail: (email) =>
        persistAndDispatch({ type: "SET_SIGNIN_EMAIL", email }),
      setSignupFullName: (name) =>
        persistAndDispatch({ type: "SET_SIGNUP_FULL_NAME", name }),
      setSignupEmail: (email) =>
        persistAndDispatch({ type: "SET_SIGNUP_EMAIL", email }),
      setForgotEmail: (email) =>
        persistAndDispatch({ type: "SET_FORGOT_EMAIL", email }),
      clearSignup: () => persistAndDispatch({ type: "CLEAR_SIGNUP" }),
    }),
    [persistAndDispatch]
  );

  const value = useMemo(
    (): AuthStoreValue => ({ state, actions }),
    [state, actions]
  );

  return (
    <AuthStoreContext.Provider value={value}>
      {children}
    </AuthStoreContext.Provider>
  );
}

const AuthStoreContext = createContext<AuthStoreValue | null>(null);

export function useAuthStore(): AuthStoreValue {
  const ctx = useContext(AuthStoreContext);
  if (!ctx) throw new Error("useAuthStore must be used within AuthProvider");
  return ctx;
}