// Runs before first paint so the page starts in the visitor's colour scheme.
document.documentElement.setAttribute('data-bs-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
