import React from 'react';
import { AlertTriangle, CheckCircle2, Info, MinusCircle, ShieldAlert } from 'lucide-react';
import { LookupMatchTier } from '../../types/valuation';

export interface BankingAlertProps {
  variant: 'info' | 'success' | 'warning' | 'error' | 'neutral';
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

const ALERT_STYLES: Record<
  BankingAlertProps['variant'],
  { box: string; iconColor: string; titleColor: string }
> = {
  info: {
    box: 'border-[#D5DAE0] bg-[#F8F9FA] text-[#1F2429]',
    iconColor: 'text-[#4B5563]',
    titleColor: 'text-[#1F2429]',
  },
  success: {
    box: 'border-[#B8DEC9] bg-[#ECF7F2] text-[#084730]',
    iconColor: 'text-[#0B5D3F]',
    titleColor: 'text-[#084730]',
  },
  warning: {
    box: 'border-[#EAD196] bg-[#FEF7E6] text-[#6E4200]',
    iconColor: 'text-[#8A5300]',
    titleColor: 'text-[#6E4200]',
  },
  error: {
    box: 'border-[#E8B8BC] bg-[#FDF2F3] text-[#641016]',
    iconColor: 'text-[#9D1D26]',
    titleColor: 'text-[#7F151D]',
  },
  neutral: {
    box: 'border-[#E2E5E9] bg-[#F9FAFB] text-[#4B5563]',
    iconColor: 'text-[#6B7280]',
    titleColor: 'text-[#1F2429]',
  },
};

export const BankingAlert: React.FC<BankingAlertProps> = ({
  variant,
  title,
  children,
  action,
  className = '',
}) => {
  const style = ALERT_STYLES[variant];
  const Icon =
    variant === 'success'
      ? CheckCircle2
      : variant === 'warning'
      ? AlertTriangle
      : variant === 'error'
      ? ShieldAlert
      : variant === 'neutral'
      ? MinusCircle
      : Info;

  return (
    <div
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-sm leading-relaxed flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between ${style.box} ${className}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconColor}`} />
        <div className="min-w-0 space-y-0.5">
          {title && <div className={`font-semibold ${style.titleColor}`}>{title}</div>}
          <div className="text-[13px] sm:text-sm">{children}</div>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

export interface MatchTierIndicatorProps {
  tier: LookupMatchTier | 'missing';
  distanceLabel?: string | null;
}

/**
 * Clean unboxed typographic distinction between Exact-location, Nearby comparable, and Missing data.
 */
export const MatchTierIndicator: React.FC<MatchTierIndicatorProps> = ({
  tier,
  distanceLabel,
}) => {
  if (tier === 'exact_location') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#0B5D3F]">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>Đúng vị trí</span>
        {distanceLabel && (
          <span className="font-normal text-[#4B5563] tabular-nums">· {distanceLabel}</span>
        )}
      </span>
    );
  }

  if (tier === 'nearby_comparable') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#8A5300]">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>Tham chiếu lân cận</span>
        {distanceLabel && (
          <span className="font-normal text-[#4B5563] tabular-nums">· {distanceLabel}</span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#525B66]">
      <MinusCircle className="h-3.5 w-3.5 shrink-0" />
      <span>Chưa có dữ liệu</span>
    </span>
  );
};

export interface BankingPageHeaderProps {
  kicker?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
}

export const BankingPageHeader: React.FC<BankingPageHeaderProps> = ({
  kicker,
  title,
  description,
  actions,
  footer,
}) => (
  <section className="banking-card p-5 sm:p-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="max-w-3xl min-w-0">
        {kicker && (
          <div className="text-xs sm:text-[13px] font-medium text-[#6B7280]">{kicker}</div>
        )}
        <h2 className="mt-1 banking-page-title">{title}</h2>
        {description && (
          <div className="mt-2 text-sm sm:text-[15px] leading-relaxed text-[#4B5563]">
            {description}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
    {footer && <div className="mt-5 border-t border-[#E2E5E9] pt-4">{footer}</div>}
  </section>
);
