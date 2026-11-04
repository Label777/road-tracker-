// Тактильный отклик. Android: Vibration API. iOS Safari Vibration API не поддерживает;
// с iOS 18 системный «тик» даёт переключатель <input switch>, который мы незаметно нажимаем.
let label;
export function haptic(kind = 'light') {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(kind === 'success' ? [12, 40, 18] : kind === 'warning' ? [30, 30, 30] : 10);
      return;
    }
    if (!label) {
      label = document.createElement('label');
      label.ariaHidden = 'true';
      label.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.append(input);
      document.body.append(label);
    }
    label.click();
  } catch { /* отклик не обязателен */ }
}
