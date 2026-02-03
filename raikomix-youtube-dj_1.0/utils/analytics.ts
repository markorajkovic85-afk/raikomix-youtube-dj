
const isDev = import.meta.env?.DEV ?? false;

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
