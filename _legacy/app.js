// SCOPE UI Screens Controller & Interactive Navigation

document.addEventListener('DOMContentLoaded', () => {
  const screens = {
    'create-account': document.getElementById('screen-create-account'),
    'login': document.getElementById('screen-login'),
    'reset-password': document.getElementById('screen-reset-password'),
    'verify-email': document.getElementById('screen-verify-email'),
    'choose-password': document.getElementById('screen-choose-password')
  };

  const tabs = document.querySelectorAll('.screen-tab-btn');
  let currentScreen = 'login';
  let countdownTimer = null;
  let countdownSeconds = 5;

  function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast-notification show ${type}`;
    setTimeout(() => {
      toast.className = 'toast-notification';
    }, 3000);
  }

  function setScreen(screenKey) {
    if (!screens[screenKey]) return;

    // Update active screen views
    Object.keys(screens).forEach(key => {
      if (key === screenKey) {
        screens[key].classList.add('active-screen');
      } else {
        screens[key].classList.remove('active-screen');
      }
    });

    // Update switcher tabs
    tabs.forEach(tab => {
      if (tab.dataset.screen === screenKey) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    currentScreen = screenKey;
    window.location.hash = screenKey;

    // If verify-email is shown, start/reset countdown
    if (screenKey === 'verify-email') {
      startResendCountdown();
    }
  }

  // Switcher Tab Clicks
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const screenKey = tab.dataset.screen;
      setScreen(screenKey);
    });
  });

  // Dynamic Navigation Links (data-navigate)
  document.querySelectorAll('[data-navigate]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetScreen = link.getAttribute('data-navigate');
      setScreen(targetScreen);
    });
  });

  // Countdown for "Resend in 5s"
  function startResendCountdown() {
    clearInterval(countdownTimer);
    countdownSeconds = 5;
    const resendWrap = document.getElementById('resend-code-wrap');
    if (!resendWrap) return;

    resendWrap.innerHTML = `Didn't a code? <span class="link-bold-red">Resend in <span id="countdown-num">${countdownSeconds}</span>s</span>`;

    countdownTimer = setInterval(() => {
      countdownSeconds--;
      const numElem = document.getElementById('countdown-num');
      if (numElem) {
        numElem.textContent = countdownSeconds;
      }

      if (countdownSeconds <= 0) {
        clearInterval(countdownTimer);
        resendWrap.innerHTML = `Didn't a code? <a href="#" id="resend-action-btn" class="link-bold-red">Resend Code</a>`;
        const resendBtn = document.getElementById('resend-action-btn');
        if (resendBtn) {
          resendBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showToast('New verification code sent to your email!', 'success');
            startResendCountdown();
          });
        }
      }
    }, 1000);
  }

  // Handle Form Submissions with pleasant simulated flows
  const formCreateAccount = document.getElementById('form-create-account');
  if (formCreateAccount) {
    formCreateAccount.addEventListener('submit', (e) => {
      e.preventDefault();
      showToast('Account created! Please verify your email.', 'success');
      setTimeout(() => setScreen('verify-email'), 500);
    });
  }

  const formLogin = document.getElementById('form-login');
  if (formLogin) {
    formLogin.addEventListener('submit', (e) => {
      e.preventDefault();
      showToast('Logging in to your projects...', 'success');
    });
  }

  const formResetPassword = document.getElementById('form-reset-password');
  if (formResetPassword) {
    formResetPassword.addEventListener('submit', (e) => {
      e.preventDefault();
      showToast('Password reset link sent to your email!', 'success');
      setTimeout(() => setScreen('verify-email'), 600);
    });
  }

  const formVerifyEmail = document.getElementById('form-verify-email');
  if (formVerifyEmail) {
    formVerifyEmail.addEventListener('submit', (e) => {
      e.preventDefault();
      showToast('Email verified successfully!', 'success');
      setTimeout(() => setScreen('choose-password'), 500);
    });
  }

  const formChoosePassword = document.getElementById('form-choose-password');
  if (formChoosePassword) {
    formChoosePassword.addEventListener('submit', (e) => {
      e.preventDefault();
      showToast('Password reset successfully! Please log in.', 'success');
      setTimeout(() => setScreen('login'), 600);
    });
  }

  // Handle hash on initial load
  const initialHash = window.location.hash.replace('#', '');
  if (initialHash && screens[initialHash]) {
    setScreen(initialHash);
  } else {
    setScreen('login');
  }

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash && screens[hash] && hash !== currentScreen) {
      setScreen(hash);
    }
  });
});
