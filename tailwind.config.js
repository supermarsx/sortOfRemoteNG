/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
    './index.html',
  ],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--color-primary-rgb) / <alpha-value>)',
        secondary: 'rgb(var(--color-secondary-rgb) / <alpha-value>)',
        accent: 'rgb(var(--color-accent-rgb) / <alpha-value>)',
        surface: 'rgb(var(--color-surface-rgb) / <alpha-value>)',
        surfaceHover: 'var(--color-surfaceHover)',
        surfaceActive: 'var(--color-surfaceActive)',
        input: 'var(--color-input)',
        inputHover: 'var(--color-inputHover)',
        background: 'rgb(var(--color-background-rgb) / <alpha-value>)',
        success: 'rgb(var(--color-success-rgb) / <alpha-value>)',
        warning: 'rgb(var(--color-warning-rgb) / <alpha-value>)',
        error: 'rgb(var(--color-error-rgb) / <alpha-value>)',
        info: 'rgb(var(--color-info-rgb) / <alpha-value>)',
        'theme-text': 'var(--color-text)',
        'text-secondary': 'var(--color-textSecondary)',
        'text-muted': 'var(--color-textMuted)',
        'theme-border': 'rgb(var(--color-border-rgb) / <alpha-value>)',
        buttonHover: 'var(--color-buttonHover)',
      },
    },
  },
  plugins: [],
};
