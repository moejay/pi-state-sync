const toast = document.querySelector('.toast');
let toastTimer;

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    const value = button.dataset.copy;
    try {
      await navigator.clipboard.writeText(value);
      button.querySelector('.copy-label').textContent = 'Copied';
      toast.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove('visible');
        button.querySelector('.copy-label').textContent = 'Copy';
      }, 1800);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(button.querySelector('code'));
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
});

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) entry.target.classList.add('revealed');
  }
}, { threshold: 0.12 });

document.querySelectorAll('.feature-card, .steps li, .secret-visual').forEach((element) => {
  element.classList.add('reveal');
  observer.observe(element);
});
