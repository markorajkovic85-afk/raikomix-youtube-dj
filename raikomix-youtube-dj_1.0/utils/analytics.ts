
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
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Analytics] ${category} > ${action}${label ? ` (${label})` : ''}${value ? ` : ${value}` : ''}`);
  }
};
