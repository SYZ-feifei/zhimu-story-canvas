export function playOpening() {
  const screen = document.querySelector('#launch-screen');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || sessionStorage.getItem('zhimu.opening')) {
    screen.remove();
    return;
  }
  sessionStorage.setItem('zhimu.opening', 'played');
  screen.classList.add('is-playing');
  screen.addEventListener('animationend', event => {
    if (event.target === screen && event.animationName === 'launch-veil') screen.remove();
  });
  setTimeout(() => screen.remove(), 1450);
}
