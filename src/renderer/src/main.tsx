import React from 'react';
import ReactDOM from 'react-dom/client';
import { isUiLanguage } from '../../shared/i18n';
import type { UiLanguage } from '../../shared/types';
import App from './App';
import { I18nProvider } from './i18n';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('root element not found');
}

const render = (locale: UiLanguage): void => {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <I18nProvider initialLocale={locale}>
        <App initialUiLanguage={locale} />
      </I18nProvider>
    </React.StrictMode>,
  );
};

void window.kataribe
  .getUiLanguage()
  .then((locale) => render(isUiLanguage(locale) ? locale : 'ja'))
  .catch(() => render('ja'));
