const toast = document.querySelector('.toast');
let toastTimer;

async function refreshPublishedVersion() {
  try {
    const response = await fetch('https://registry.npmjs.org/%40moejay%2Fpi-state-sync/latest', {
      cache: 'no-store',
    });
    if (!response.ok) return;
    const metadata = await response.json();
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version ?? '')) return;
    document.querySelectorAll('[data-package-version]').forEach((element) => {
      element.textContent = `v${metadata.version}`;
    });
  } catch {
    // Keep the baked release version when npm is unavailable.
  }
}

void refreshPublishedVersion();

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
