import { useState } from 'react';
import { ENHANCEMENT_STATE_MESSAGE_KEYS } from '../../shared/i18n';
import type { EnhancementFile } from '../../shared/types';
import { EnhancementStatus } from './EnhancementStatus';
import {
  enhancementStateClass,
  summarizeEnhancement,
  type EnhancementDisplayState,
} from './enhancement-state';
import { useI18n, type I18nValue } from './i18n';

type EnhancementStatusSummaryProps = {
  enhancement: EnhancementFile | null;
  warning: string | null;
};

function summaryLabel(
  state: EnhancementDisplayState | null,
  t: I18nValue['t'],
): string | null {
  if (state === null) {
    return null;
  }
  if (state === 'warning') {
    return t('状態を読み込めません');
  }
  return t(ENHANCEMENT_STATE_MESSAGE_KEYS[state]);
}

/**
 * 音声強調の状態を 1 行のボタンにまとめ、詳細をモーダルで表示する。
 */
export function EnhancementStatusSummary({
  enhancement,
  warning,
}: EnhancementStatusSummaryProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const state = summarizeEnhancement(enhancement, warning);
  const label = summaryLabel(state, t);
  if (state === null || label === null) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        className="enhancement-summary-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span>{t('音声強調')}</span>
        <span className={`status-chip ${enhancementStateClass(state)}`}>
          {label}
        </span>
        <span className="enhancement-summary-action">{t('詳細')}</span>
      </button>
      {open ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="enhancement-status-title"
        >
          <div className="confirm-dialog enhancement-dialog">
            <div className="confirm-head">
              <div>
                <p className="section-label">{t('音声強調')}</p>
                <h2 id="enhancement-status-title">{t('音声強調の状態')}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t('閉じる')}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="enhancement-dialog-body">
              <EnhancementStatus
                enhancement={enhancement}
                warning={warning}
                showHeading={false}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
