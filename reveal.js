// One-time entrance for the sections below the opening: headings tilt up, cards rise. Without IntersectionObserver or with reduced motion everything simply stays visible.
(() => {
  'use strict';
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  document.documentElement.classList.add('js-reveal');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
  items.forEach(item => observer.observe(item));
})();
