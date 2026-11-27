import React, { useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { navigateToPath } from '../../utils/navigation';

export const AdminLoginPage: React.FC = () => {
  const { signInWithGoogle, signInWithEmail, errorMessage, isBusy, clearError } = useAdminAuth();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signInWithEmail(email, password);
    setPassword('');
  };

  return (
    <div className="min-h-screen bg-[#F6F7F8] flex flex-col">
      <div className="h-[3px] w-full bg-[#9D1D26]" aria-hidden="true" />
      <div className="flex flex-1 flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-md">
          <button
            type="button"
            onClick={() => navigateToPath('/')}
            className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4B5563] hover:text-[#9D1D26] transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            Quay lại ứng dụng tra cứu
          </button>

          <div className="banking-card overflow-hidden">
            {/* Institutional Header */}
            <div className="bg-[#9D1D26] px-6 py-5 text-white border-b-2 border-[#0B5D3F]">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/15 border border-white/20 text-white">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-tight text-white leading-snug">
                    Cổng Quản Trị (Admin)
                  </h1>
                  <p className="text-[13px] text-white/85">
                    Tra cứu nhanh giá đất – Khánh Hòa
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 sm:p-7">
              <p className="text-sm leading-relaxed text-[#4B5563]">
                Khu vực dành riêng cho Quản trị viên được cấp quyền qua Firebase Authentication (Google Sign-In) và kiểm soát trực tiếp bởi Cloud Firestore Security Rules. Hệ thống không hỗ trợ tự đăng ký tài khoản quản trị.
              </p>

              {errorMessage && (
                <div
                  role="alert"
                  className="mt-5 flex items-start gap-2.5 rounded-md border border-[#E8B8BC] bg-[#FDF2F3] p-3.5 text-[13px] text-[#641016]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#9D1D26]" />
                  <div className="flex-1 leading-relaxed">{errorMessage}</div>
                </div>
              )}

              {/* Primary Google Sign-In */}
              <div className="mt-6 space-y-3.5">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void signInWithGoogle()}
                  className="banking-btn-primary w-full"
                >
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M21.35 11.1H12v2.92h5.35c-.23 1.52-1.74 4.46-5.35 4.46-3.22 0-5.85-2.66-5.85-5.95s2.63-5.95 5.85-5.95c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 4.02 14.56 3.1 12 3.1 7.03 3.1 3 7.13 3 12.1s4.03 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.59-.06-1.04-.14-1.2z"
                      />
                    </svg>
                  )}
                  <span>{isBusy ? 'Đang xác thực...' : 'Đăng nhập bằng tài khoản Google'}</span>
                </button>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-[#E2E5E9]" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        clearError();
                        setShowEmailForm((prev) => !prev);
                      }}
                      className="bg-white px-2.5 text-[#4B5563] hover:text-[#9D1D26] font-medium cursor-pointer"
                    >
                      {showEmailForm
                        ? 'Ẩn đăng nhập Email / Mật khẩu'
                        : 'Hoặc đăng nhập bằng Email & Mật khẩu Firebase'}
                    </button>
                  </div>
                </div>

                {showEmailForm && (
                  <form onSubmit={handleEmailSubmit} className="space-y-4 pt-1" autoComplete="off">
                    <div>
                      <label htmlFor="admin-email" className="banking-label">
                        Email quản trị viên
                      </label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#6B7280]" />
                        <input
                          id="admin-email"
                          type="email"
                          required
                          disabled={isBusy}
                          value={email}
                          onChange={(e) => {
                            clearError();
                            setEmail(e.target.value);
                          }}
                          placeholder="admin@donvi.vn"
                          autoComplete="username"
                          className="banking-input pl-9"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="admin-password" className="banking-label">
                        Mật khẩu
                      </label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#6B7280]" />
                        <input
                          id="admin-password"
                          type="password"
                          required
                          disabled={isBusy}
                          value={password}
                          onChange={(e) => {
                            clearError();
                            setPassword(e.target.value);
                          }}
                          placeholder="Nhập mật khẩu Firebase Auth"
                          autoComplete="current-password"
                          className="banking-input pl-9"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isBusy}
                      className="banking-btn-secondary w-full"
                    >
                      {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                      <span>Đăng nhập bằng Email</span>
                    </button>
                  </form>
                )}
              </div>

              <div className="mt-6 border-t border-[#E2E5E9] pt-4 text-xs leading-relaxed text-[#6B7280]">
                Mọi quyền ghi dữ liệu đều áp dụng nguyên tắc từ chối mặc định (deny-by-default) và xác minh trực tiếp bằng Cloud Firestore Security Rules (database <span className="font-mono text-[#1F2429]">giadat</span>).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
