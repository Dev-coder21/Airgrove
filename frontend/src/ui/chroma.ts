/** Section headings: letters assemble with a chromatic split as they scroll in (both directions). */
import { reduce } from '../core/util';

export function chromaSet(el: HTMLElement, text: string): void {
  el.setAttribute('aria-label', text);
  el.classList.add('ch');
  let i = 0;
  el.innerHTML = text
    .split(' ')
    .map((w) => '<span class="wd" aria-hidden="true">' + w.split('').map((ch) => '<span class="l" style="--i:' + i++ + '">' + ch.replace('&', '&amp;').replace('<', '&lt;') + '</span>').join('') + '</span>')
    .join(' ');
  if (el.classList.contains('in')) {
    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');
  }
}

export function initHeadings(): void {
  const hs = [].slice.call(document.querySelectorAll('.sec h2')) as HTMLElement[];
  hs.forEach((h) => chromaSet(h, h.getAttribute('aria-label') || h.textContent || ''));
  if (reduce || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (es) => {
      es.forEach((e) => {
        const h = e.target;
        if (e.isIntersecting && e.intersectionRatio >= 0.35) { h.classList.remove('pending'); h.classList.add('in'); }
        else if (!e.isIntersecting) { h.classList.remove('in'); h.classList.add('pending'); }
      });
    },
    { threshold: [0, 0.35] },
  );
  hs.forEach((h) => { h.classList.add('pending'); io.observe(h); });
}
