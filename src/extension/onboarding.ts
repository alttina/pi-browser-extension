document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const code = btn.previousElementSibling?.textContent || '';
    navigator.clipboard.writeText(code);
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = 'Copy'), 1200);
  });
});

document.getElementById('runInstaller')?.addEventListener('click', () => {
  alert('Run: curl -fsSL https://pi-browser-agent.dev/install.sh | bash');
});
