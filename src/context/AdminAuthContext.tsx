import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, FIXED_ADMIN_EMAIL, firestoreDatabaseId, googleProvider } from '../firebase';
import { verifyAdminFirestoreAccess } from '../services/firestoreDatasetStore';
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
  databaseId: string;
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

interface AdminVerifyOutcome {
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
      return 'Phương thức đăng nhập Email/Mật khẩu chưa được bật trên Firebase Console. Vui lòng dùng Đăng nhập bằng Google.';
    case 'auth/unauthorized-domain':
      return 'Tên miền hiện tại chưa được thêm vào Authorized Domains trên Firebase Authentication.';
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

  // Single-flight coordinator prevents duplicate verification probes without caching
  // completed admin status or ever writing admin authorization state to localStorage.
  const coordinatorRef = useRef(createVerificationCoordinator<AdminVerifyOutcome>());
  const interactiveSignInRef = useRef<boolean>(false);

  const verifyWithFirebaseAndRules = useCallback(
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
        async (): Promise<AdminVerifyOutcome> => {
          try {
            // 1. Refresh Firebase ID token & check A1 Single Fixed Admin Email + emailVerified
            await user.getIdToken(forceRefreshToken);
            const normalizedEmail = (user.email ?? '').trim().toLowerCase();

            if (!normalizedEmail || normalizedEmail !== FIXED_ADMIN_EMAIL) {
              return {
                status: 'access_denied',
                session: null,
                errorMessage:
                  'Tài khoản đã xác thực nhưng không phải Email Quản trị cố định được phân quyền (Access Denied).',
                authorized: false,
              };
            }

            if (user.emailVerified !== true) {
              return {
                status: 'access_denied',
                session: null,
                errorMessage:
                  'Tài khoản quản trị bắt buộc phải có email đã xác minh (email_verified = true). Vui lòng đăng nhập bằng Google.',
                authorized: false,
              };
            }

            // 2. Verify live Cloud Firestore Security Rules grant Admin privileges on database "giadat"
            const rulesProbe = await verifyAdminFirestoreAccess();
            if (!rulesProbe.ok) {
              if (rulesProbe.reason === 'permission_denied') {
                return {
                  status: 'access_denied',
                  session: null,
                  errorMessage:
                    rulesProbe.message ||
                    'Cloud Firestore Security Rules từ chối quyền quản trị (403).',
                  authorized: false,
                };
              }
              return {
                status: 'error',
                session: null,
                errorMessage:
                  rulesProbe.message ||
                  'Không thể xác minh quyền Quản trị với Cloud Firestore. Truy cập bị từ chối mặc định.',
                authorized: false,
              };
            }

            return {
              status: 'authorized',
              session: {
                uid: user.uid,
                email: user.email,
                emailVerified: true,
                authMethod: 'firebase_auth_firestore_rules_a1',
                serverVerifiedAt: new Date().toISOString(),
                databaseId: firestoreDatabaseId,
              },
              errorMessage: null,
              authorized: true,
            };
          } catch (error) {
            return {
              status: 'error',
              session: null,
              errorMessage:
                error instanceof Error
                  ? error.message
                  : 'Không thể xác minh phiên quản trị với Firebase. Truy cập bị từ chối mặc định.',
              authorized: false,
            };
          }
        }
      );

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
      if (interactiveSignInRef.current) {
        setStatus('verifying');
        return;
      }
      void verifyWithFirebaseAndRules(user, false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [verifyWithFirebaseAndRules]);

  const signInWithGoogle = useCallback(async () => {
    setIsBusy(true);
    setErrorMessage(null);
    interactiveSignInRef.current = true;
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      setFirebaseUser(credential.user);
      await verifyWithFirebaseAndRules(credential.user, true);
    } catch (error) {
      setErrorMessage(mapFirebaseAuthError(error));
      if (!auth.currentUser) {
        setStatus('unauthenticated');
      }
    } finally {
      interactiveSignInRef.current = false;
      setIsBusy(false);
    }
  }, [verifyWithFirebaseAndRules]);

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
        await verifyWithFirebaseAndRules(credential.user, true);
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
    [verifyWithFirebaseAndRules]
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
      return verifyWithFirebaseAndRules(currentUser, forceRefreshToken);
    },
    [verifyWithFirebaseAndRules]
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
