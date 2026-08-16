const revealEls = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.16 });
revealEls.forEach((el) => observer.observe(el));

const card = document.querySelector('.tilt-card');
if (card && window.matchMedia('(pointer: fine)').matches) {
  window.addEventListener('mousemove', (event) => {
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `rotateX(${7 - y * 8}deg) rotateY(${-10 + x * 12}deg) translateY(-8px)`;
  });
  window.addEventListener('mouseleave', () => {
    card.style.transform = '';
  });
}

const metrics = document.querySelectorAll('.metric strong');
setInterval(() => {
  metrics.forEach((metric, index) => {
    metric.animate([
      { filter: 'drop-shadow(0 0 0 rgba(19,241,252,0))' },
      { filter: 'drop-shadow(0 0 14px rgba(19,241,252,.45))' },
      { filter: 'drop-shadow(0 0 0 rgba(19,241,252,0))' }
    ], { duration: 1200, delay: index * 110, easing: 'ease-out' });
  });
}, 4200);
