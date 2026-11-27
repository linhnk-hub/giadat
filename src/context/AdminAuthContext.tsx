import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { createVerificationCoordinator } from '../utils/adminVerifyCoordinator';

export type AdminAuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'verifying'
  | 'authorized'
  | 'access_denied'
  | 'error';

export interface VerifiedAdminSession {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  authMethod: string;
  serverVerifiedAt: string;
}

interface AdminAuthContextValue {
  status: AdminAuthStatus;
  firebaseUser: User | null;
  adminSession: VerifiedAdminSession | null;
  errorMessage: string | null;
  isBusy: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOutAdmin: () => Promise<void>;
  reverifySession: (forceRefreshToken?: boolean) => Promise<boolean>;
  getAdminAuthHeaders: (forceRefreshToken?: boolean) => Promise<Record<string, string>>;
  clearError: () => void;
}

interface BackendVerifyOutcome {
  status: AdminAuthStatus;
  session: VerifiedAdminSession | null;
  errorMessage: string | null;
  authorized: boolean;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function mapFirebaseAuthError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại thông tin tài khoản quản trị.';
    case 'auth/invalid-email':
      return 'Địa chỉ email không đúng định dạng.';
    case 'auth/user-disabled':
      return 'Tài khoản này đã bị vô hiệu hóa trên hệ thống xác thực.';
    case 'auth/too-many-requests':
      return 'Tài khoản tạm thời bị giới hạn do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.';
    case 'auth/popup-closed-by-user':
      return 'Cửa sổ đăng nhập Google đã được đóng trước khi hoàn tất.';
    case 'auth/popup-blocked':
      return 'Trình duyệt đã chặn cửa sổ đăng nhập Google. Vui lòng cho phép popup cho trang này và thử lại.';
    case 'auth/operation-not-allowed':
      return 'Phương thức đăng nhập Email/Mật khẩu chưa được bật trên Firebase Console. Vui lòng dùng Đăng nhập bằng Google hoặc bật Email/Password trong Firebase Authentication.';
    case 'auth/network-request-failed':
      return 'Không thể kết nối tới dịch vụ xác thực Firebase. Vui lòng kiểm tra kết nối mạng.';
    default:
      return 'Đăng nhập không thành công. Vui lòng kiểm tra lại tài khoản hoặc thử lại sau.';
  }
}

export const AdminAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AdminAuthStatus>('loading');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [adminSession, setAdminSession] = useState<VerifiedAdminSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  // Single-flight coordinator: prevents overlapping duplicate GET /api/admin/session calls
  // without caching completed results or storing any admin state in localStorage.
  const coordinatorRef = useRef(createVerificationCoordinator<BackendVerifyOutcome>());
  // Tracks an active interactive sign-in (Google/Email) so onAuthStateChanged hands off
  // backend verification to the sign-in flow instead of triggering a second concurrent fetch.
  const interactiveSignInRef = useRef<boolean>(false);

  const verifyWithBackend = useCallback(
    async (user: User | null, forceRefreshToken = false): Promise<boolean> => {
      if (!user) {
        coordinatorRef.current.invalidate();
        setAdminSession(null);
        setStatus('unauthenticated');
        return false;
      }

      setStatus('verifying');

      const result = await coordinatorRef.current.run(
        user.uid,
        forceRefreshToken,
        async (): Promise<BackendVerifyOutcome> => {
          try {
            const idToken = await user.getIdToken(forceRefreshToken);
            const response = await fetch('/api/admin/session', {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${idToken}`,
              },
              cache: 'no-store',
            });

            const payload = (await response.json().catch(() => ({}))) as {
              authenticated?: boolean;
              isAdmin?: boolean;
              code?: string;
              user?: {
                uid?: string;
                email?: string | null;
                emailVerified?: boolean;
              };
              authMethod?: string;
              serverVerifiedAt?: string;
              error?: string;
            };

            if (
              response.ok &&
              payload.authenticated === true &&
              payload.isAdmin === true &&
              payload.user?.uid
            ) {
              return {
                status: 'authorized',
                session: {
                  uid: payload.user.uid,
                  email: payload.user.email ?? user.email ?? null,
                  emailVerified: payload.user.emailVerified === true,
                  authMethod: payload.authMethod ?? 'single_fixed_admin_email',
                  serverVerifiedAt: payload.serverVerifiedAt ?? new Date().toISOString(),
                },
                errorMessage: null,
                authorized: true,
              };
            }

            if (response.status === 403) {
              return {
                status: 'access_denied',
                session: null,
                errorMessage:
                  payload.error ||
                  'Tài khoản đã xác thực nhưng không có quyền Quản trị viên (Access Denied).',
                authorized: false,
              };
            }

            if (response.status === 401) {
              return {
                status: 'unauthenticated',
                session: null,
                errorMessage:
                  payload.error ||
                  'Phiên xác thực không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
                authorized: false,
              };
            }

            // Fail closed on 503 (Firestore unavailable / rules not ready) or any unexpected server response
            return {
              status: 'error',
              session: null,
              errorMessage:
                payload.error ||
                'Không thể xác minh quyền Quản trị viên với máy chủ. Truy cập bị từ chối mặc định.',
              authorized: false,
            };
          } catch {
            return {
              status: 'error',
              session: null,
              errorMessage:
                'Không kết nối được máy chủ xác minh quyền Quản trị viên. Vui lòng thử lại.',
              authorized: false,
            };
          }
        }
      );

      // Ignore stale responses superseded by a newer verification or sign-out
      if (!result.applied) {
        return false;
      }

      setAdminSession(result.value.session);
      setErrorMessage(result.value.errorMessage);
      setStatus(result.value.status);
      return result.value.authorized;
    },
    []
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!active) return;
      setFirebaseUser(user);
      if (!user) {
        coordinatorRef.current.invalidate();
        setAdminSession(null);
        setStatus('unauthenticated');
        return;
      }
      // During interactive sign-in (Google/Email), the sign-in handler itself performs
      // the single authoritative verifyWithBackend(credential.user, true) call.
      if (interactiveSignInRef.current) {
        setStatus('verifying');
        return;
      }
      // On F5 / page reload / session restore, always verify live against backend
      void verifyWithBackend(user, false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [verifyWithBackend]);

  const signInWithGoogle = useCallback(async () => {
    setIsBusy(true);
    setErrorMessage(null);
    interactiveSignInRef.current = true;
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      setFirebaseUser(credential.user);
      await verifyWithBackend(credential.user, true);
    } catch (error) {
      setErrorMessage(mapFirebaseAuthError(error));
      if (!auth.currentUser) {
        setStatus('unauthenticated');
      }
    } finally {
      interactiveSignInRef.current = false;
      setIsBusy(false);
    }
  }, [verifyWithBackend]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password) {
        setErrorMessage('Vui lòng nhập đầy đủ email và mật khẩu quản trị.');
        return;
      }

      setIsBusy(true);
      setErrorMessage(null);
      interactiveSignInRef.current = true;
      try {
        const credential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
        setFirebaseUser(credential.user);
        await verifyWithBackend(credential.user, true);
      } catch (error) {
        setErrorMessage(mapFirebaseAuthError(error));
        if (!auth.currentUser) {
          setStatus('unauthenticated');
        }
      } finally {
        interactiveSignInRef.current = false;
        setIsBusy(false);
      }
    },
    [verifyWithBackend]
  );

  const signOutAdmin = useCallback(async () => {
    setIsBusy(true);
    setErrorMessage(null);
    interactiveSignInRef.current = false;
    coordinatorRef.current.invalidate();
    try {
      await signOut(auth);
      setFirebaseUser(null);
      setAdminSession(null);
      setStatus('unauthenticated');
    } catch {
      setErrorMessage('Đã xảy ra lỗi khi đăng xuất. Vui lòng thử lại.');
    } finally {
      setIsBusy(false);
    }
  }, []);

  const reverifySession = useCallback(
    async (forceRefreshToken = false): Promise<boolean> => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        coordinatorRef.current.invalidate();
        setAdminSession(null);
        setStatus('unauthenticated');
        return false;
      }
      return verifyWithBackend(currentUser, forceRefreshToken);
    },
    [verifyWithBackend]
  );

  const getAdminAuthHeaders = useCallback(
    async (forceRefreshToken = false): Promise<Record<string, string>> => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Chưa đăng nhập tài khoản quản trị.');
      }
      const token = await currentUser.getIdToken(forceRefreshToken);
      return {
        Authorization: `Bearer ${token}`,
      };
    },
    []
  );

  const clearError = useCallback(() => setErrorMessage(null), []);

  return (
    <AdminAuthContext.Provider
      value={{
        status,
        firebaseUser,
        adminSession,
        errorMessage,
        isBusy,
        signInWithGoogle,
        signInWithEmail,
        signOutAdmin,
        reverifySession,
        getAdminAuthHeaders,
        clearError,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
};

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth phải được sử dụng bên trong AdminAuthProvider.');
  }
  return ctx;
}
