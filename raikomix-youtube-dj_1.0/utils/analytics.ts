
const isDev =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
  (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');

export const trackEvent = (
  category: string,
  action: string,
  label?: string,
  value?: number
) => {
  // Check if Google Analytics is initialized
  if ((window as any).gtag) {
    (window as any).gtag('event', action, {
      event_category: category,
      event_label: label,
      value: value
    });
  }
  
  // Also log to console in development
  if (isDev) {
    console.log(
      `[Analytics] ${category} > ${action}` +
        (label ? ` (${label})` : '') +
        (value !== undefined ? ` : ${value}` : '')
    );
  }
};
